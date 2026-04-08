import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { MemorySystemAPI } from "./index";
import { BudgetMode, TaskType } from "./schemas";
import * as path from "path";

/** Stable DB location: default is <MIMIR repo root>/mimir.db (parent of src/), not process.cwd() (Cursor varies cwd). */
function resolveMcpDbPath(): string {
  const fromEnv = process.env.MIMIR_DB_PATH?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(path.dirname(__dirname), "mimir.db");
}

// Define the core MCP Server
const server = new Server(
  {
    name: "mimir-v2-mcp",
    version: "2.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const memory = new MemorySystemAPI();

async function initMemory() {
  const dbPath = resolveMcpDbPath();
  await memory.init(dbPath);
  console.error(`[mimir-mcp] database: ${dbPath}`);
}

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "mimir_ingest",
        description:
          "Ingests a repository path: builds scoped symbol IDs, resolved FILE import graph, dependents, CodeRank centrality, and stores ingest metadata (root, time, git HEAD when available).",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute path to the repository directory to ingest." }
          },
          required: ["path"],
        },
      },
      {
        name: "mimir_build_packet",
        description:
          "Builds a YAML context packet (relevance_v1): ranked intents/tests/episodes, graph-derived symbols, lesson_hints, selection_meta (ingest info + omitted counts). Run FIRST when starting a task. Prefer scoped symbols like SYMBOL:relative/path.ts::ExportedName after ingest.",
        inputSchema: {
          type: "object",
          properties: {
            task_id: { type: "string", description: "Unique identifier for this task (e.g., T-123)." },
            objective: { type: "string", description: "A comprehensive description of the goal." },
            task_type: { 
                type: "string", 
                enum: ["bug_fix", "feature_addition", "refactor", "architecture_change", "test_repair", "config_or_infra", "performance", "security", "research_or_exploration", "documentation"],
                description: "Classification of the task." 
            },
            mode: {
                type: "string",
                enum: ["scout", "operate", "investigate", "forensics"],
                description: "The token budget mode. Start with 'scout' (2k tokens). Upgrade to 'operate' (8k tokens) only if deep handles are needed."
            },
            symbols: {
              type: "array",
              items: { type: "string" },
              description:
                "Seed symbols: short names or scoped IDs from ingest (e.g. SYMBOL:src/foo.ts::MyClass or ClassName.method).",
            },
            files: {
              type: "array",
              items: { type: "string" },
              description: "Absolute or project-relative paths to relevant files.",
            },
          },
          required: ["task_id", "objective", "task_type", "mode", "symbols", "files"],
        },
      },
      {
        name: "mimir_expand_handle",
        description:
          "Expands a handle within the mode token budget. Supports RULE/CONSTRAINT/INVARIANT/DECISION/NON_GOAL, TEST/VERIFIER, ATTEMPT, FILE/SYMBOL (optional ' [STATUS]' suffix stripped). Returns JSON for the entity.",
        inputSchema: {
          type: "object",
          properties: {
            handle: {
              type: "string",
              description: "Handle from the packet (e.g. RULE:id, TEST:id, SYMBOL:path::Name [VALID]).",
            },
            mode: { type: "string", enum: ["scout", "operate", "investigate", "forensics"], description: "The current budget mode you are operating in."}
          },
          required: ["handle", "mode"],
        },
      },
      {
        name: "mimir_record_episode",
        description: "Saves task outcomes (assumptions, failed hypotheses, verdicts). Run this AFTER finishing or failing a task.",
        inputSchema: {
          type: "object",
          properties: {
            task_id: { type: "string" },
            objective: { type: "string" },
            assumptions: { type: "array", items: { type: "string" } },
            files_touched: { type: "array", items: { type: "string" } },
            commands_run: { type: "array", items: { type: "string" } },
            outputs_summarized: { type: "string" },
            tests_run: { type: "array", items: { type: "string" } },
            verdicts: { type: "string", enum: ["PASS", "FAIL", "ERROR", "PENDING"] },
            failed_hypotheses: { type: "array", items: { type: "string" }, description: "Crucial: list explicitly what you tried that did NOT work." },
            accepted_solution: { type: "string" },
            residual_risks: { type: "array", items: { type: "string" } },
            next_best_action: { type: "string" }
          },
          required: ["task_id", "objective", "assumptions", "files_touched", "commands_run", "outputs_summarized", "tests_run", "verdicts", "failed_hypotheses", "residual_risks", "next_best_action"],
        },
      },
      {
        name: "mimir_record_decision",
        description: "Saves long-term architectural constraints, invariants, or non-goals into the Intent Ledger.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Unique ID without spaces, e.g., NO_DIRECT_DB_ACCESS" },
            type: { type: "string", enum: ["RULE", "CONSTRAINT", "INVARIANT", "DECISION", "NON_GOAL"] },
            description: { type: "string", description: "Clear explanation of the rule." },
            subsystems: { type: "array", items: { type: "string" } }
          },
          required: ["id", "type", "description"],
        },
      },
      {
        name: "mimir_run_gc",
        description:
          "Episodic consolidation: repeated failed hypotheses become AUTO_RULE_* intents, episodes purged, and a line appended to global lesson hints.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      }
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "mimir_ingest") {
      const { path: repoPath } = args as any;
      const root = path.resolve(repoPath);
      await memory.ingest_repo(root);
      const nodeCount = await memory.storage.countStructuralNodes();
      const dbFile = memory.storage.getDataFilePath();
      let text = `Successfully ingested repository at ${root}. structural_graph nodes: ${nodeCount}. database: ${dbFile}`;
      if (nodeCount === 0) {
        text +=
          " WARNING: zero graph nodes — confirm the path is readable and contains .ts/.js/.py sources; if the DB path was wrong before, set MIMIR_DB_PATH or restart MCP after upgrading.";
      }
      return { content: [{ type: "text", text }] };
    } 
    
    else if (name === "mimir_build_packet") {
      const { task_id, objective, task_type, mode, symbols, files } = args as any;
      const packetYaml = await memory.build_context_packet(
        task_id, objective, task_type as TaskType, mode as BudgetMode, { symbols, files }
      );
      return { content: [{ type: "text", text: packetYaml }] };
    } 
    
    else if (name === "mimir_expand_handle") {
      const { handle, mode } = args as any;
      const budget = memory.tokenGovernor.createBudget(mode as BudgetMode);
      // Hack to allow expansion, ideally we pass the budget state, but for a stateless tool call we estimate fresh
      const expanded = await memory.expand_handle(handle, budget);
      if (expanded) {
         return { content: [{ type: "text", text: expanded }] };
      } else {
         return { content: [{ type: "text", text: `Handle '${handle}' not found or expansion exceeded token budget for mode '${mode}'.` }] };
      }
    } 
    
    else if (name === "mimir_record_episode") {
      const ep = args as any;
      ep.timestamp = new Date().toISOString();
      await memory.record_episode(ep);
      return { content: [{ type: "text", text: `Successfully recorded episode for task ${ep.task_id}.` }] };
    } 
    
    else if (name === "mimir_record_decision") {
      const dec = args as any;
      await memory.record_decision({
         id: dec.id,
         type: dec.type,
         description: dec.description,
         target_scope: { subsystems: dec.subsystems || [] }
      });
      const handlePrefix =
        dec.type === "CONSTRAINT" ? "CONSTRAINT" :
        dec.type === "INVARIANT" ? "INVARIANT" :
        dec.type === "DECISION" ? "DECISION" :
        dec.type === "NON_GOAL" ? "NON_GOAL" : "RULE";
      return { content: [{ type: "text", text: `Successfully recorded decision ${handlePrefix}:${dec.id}.` }] };
    }

    else if (name === "mimir_run_gc") {
      await memory.lifecycleManager.runEpisodicConsolidation();
      return { content: [{ type: "text", text: `Successfully ran episodic consolidation (Garbage Collection). Repeated failures synthesized into Intent Rules.` }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error executing tool ${name}: ${error.message}` }],
      isError: true,
    };
  }
});

// Start the server using stdio transport
async function main() {
  await initMemory();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server startup error:", error);
  process.exit(1);
});
