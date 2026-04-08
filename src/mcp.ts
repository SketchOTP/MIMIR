import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { MemorySystemAPI } from "./index";
import {
  BudgetMode,
  TaskType,
  ValidationEntry,
  RecordProvenance,
  IntentDecision,
  SubsystemCard,
  TraceEntry,
} from "./schemas";
import { scanRecordedPayload } from "./secrets";
import * as path from "path";
import { resolveMcpDbPath } from "./mcp_db_path";
import { applyCiResult } from "./ci_apply";
import type { BuildPacketOptions } from "./context_builder";
import { osDisplayName } from "./platform";

function guardSecrets(label: string, payload: unknown): void {
  const r = scanRecordedPayload(label, payload);
  if (!r.ok) throw new Error(r.reason);
}

function pickProvenance(v: Record<string, unknown>): RecordProvenance | undefined {
  const p: RecordProvenance = {};
  if (typeof v.commit_sha === "string" && v.commit_sha) p.commit_sha = v.commit_sha;
  if (typeof v.ci_run_url === "string" && v.ci_run_url) p.ci_run_url = v.ci_run_url;
  if (typeof v.ci_run_id === "string" && v.ci_run_id) p.ci_run_id = v.ci_run_id;
  if (typeof v.repo_head_at_close === "string" && v.repo_head_at_close) p.repo_head_at_close = v.repo_head_at_close;
  return Object.keys(p).length > 0 ? p : undefined;
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x));
}

function episodeVerdict(v: unknown): "PASS" | "FAIL" | "ERROR" | "PENDING" {
  if (v === "PASS" || v === "FAIL" || v === "ERROR" || v === "PENDING") return v;
  return "ERROR";
}

function validationVerdict(v: unknown): ValidationEntry["last_run_verdict"] {
  if (v === "PASS" || v === "FAIL" || v === "PENDING") return v;
  return "PENDING";
}

// Define the core MCP Server
const server = new Server(
  {
    name: "mimir-v2-mcp",
    version: "4.0.1",
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
  console.error(`[mimir-mcp] platform: ${osDisplayName()}`);
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
          "Builds a YAML context packet (relevance_v1): ranked intents/tests/subsystem_cards/episodes, graph-derived symbols, lesson_hints, selection_meta (ingest + continuation + omitted counts). Run FIRST when starting a task. Prefer scoped symbols like SYMBOL:relative/path.ts::ExportedName after ingest.",
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
            packet_mode: {
              type: "string",
              enum: ["full", "delta"],
              description:
                "full = complete YAML packet; delta = handle-level diff vs last snapshot for this task_id (smaller follow-up).",
            },
            include_git_path_diff: {
              type: "boolean",
              description:
                "When packet_mode=delta and repo was ingested: include git_path_changes since ingest HEAD.",
            },
          },
          required: ["task_id", "objective", "task_type", "mode", "symbols", "files"],
        },
      },
      {
        name: "mimir_expand_handle",
        description:
          "Expands a handle within the mode token budget. Supports RULE/CONSTRAINT/INVARIANT/DECISION/NON_GOAL, TEST/VERIFIER, SUBSYSTEM, ATTEMPT, FILE/SYMBOL (optional ' [STATUS]' suffix stripped). Returns JSON for the entity.",
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
            next_best_action: { type: "string" },
            commit_sha: { type: "string", description: "Optional repo commit for audit trail." },
            ci_run_url: { type: "string", description: "Optional CI run / Actions URL." },
            ci_run_id: { type: "string", description: "Optional CI run id." },
            repo_head_at_close: { type: "string", description: "Optional git HEAD when recording (e.g. git rev-parse)." },
          },
          required: ["task_id", "objective", "assumptions", "files_touched", "commands_run", "outputs_summarized", "tests_run", "verdicts", "failed_hypotheses", "residual_risks", "next_best_action"],
        },
      },
      {
        name: "mimir_record_decision",
        description:
          "Saves long-term architectural constraints, invariants, or non-goals into the Intent Ledger. Use binding=hard for constitutional rules (listed first in packets).",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Unique ID without spaces, e.g., NO_DIRECT_DB_ACCESS" },
            type: { type: "string", enum: ["RULE", "CONSTRAINT", "INVARIANT", "DECISION", "NON_GOAL"] },
            description: { type: "string", description: "Clear explanation of the rule." },
            subsystems: { type: "array", items: { type: "string" } },
            binding: {
              type: "string",
              enum: ["hard", "soft"],
              description: "hard = prioritize in context packets; soft = default.",
            },
            reference_url: { type: "string", description: "Optional ADR / issue / doc URL." },
          },
          required: ["id", "type", "description"],
        },
      },
      {
        name: "mimir_record_validation",
        description:
          "Registers a test or verifier in validation_registry (TEST: / VERIFIER: handles in packets and mimir_expand_handle). INVARIANT rows appear as VERIFIER: lines in context packets.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Unique ID, e.g. auth_integration_smoke" },
            type: { type: "string", enum: ["TEST", "VERIFIER", "INVARIANT"], description: "TEST → TEST:id; VERIFIER and INVARIANT → VERIFIER:id in packets." },
            target_symbols: { type: "array", items: { type: "string" }, description: "Scoped symbol ids or names for relevance ranking." },
            target_files: { type: "array", items: { type: "string" }, description: "Paths for relevance ranking." },
            known_failure_signatures: { type: "array", items: { type: "string" }, description: "Optional failure tokens or messages to remember." },
            last_run_verdict: {
              type: "string",
              enum: ["PASS", "FAIL", "PENDING"],
              description: "Latest known result (default PENDING).",
            },
            last_run_timestamp: { type: "string", description: "ISO timestamp; defaults to now if omitted." },
            commit_sha: { type: "string", description: "Optional commit this run refers to." },
            ci_run_url: { type: "string", description: "Optional CI URL." },
            ci_run_id: { type: "string", description: "Optional CI run id." },
          },
          required: ["id", "type"],
        },
      },
      {
        name: "mimir_record_subsystem_card",
        description:
          "Registers a domain subsystem summary (~100-token style): public API symbols and invariants. Appears as SUBSYSTEM:… handles in packets; expand with mimir_expand_handle.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Stable id with prefix SUBSYSTEM:Name (e.g. SUBSYSTEM:Auth).",
            },
            description: { type: "string", description: "Short narrative of the subsystem." },
            public_api_symbols: {
              type: "array",
              items: { type: "string" },
              description: "Exported symbols or SYMBOL: paths for relevance.",
            },
            known_invariants: {
              type: "array",
              items: { type: "string" },
              description: "Rules that should hold in this area.",
            },
          },
          required: ["id", "description"],
        },
      },
      {
        name: "mimir_record_trace",
        description:
          "Records an execution trace: boosts coverage on matching graph symbols (telemetry). Verdict PASS or FAIL.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Unique trace id." },
            target_symbols: {
              type: "array",
              items: { type: "string" },
              description: "Symbol ids or substrings matched against the structural graph.",
            },
            verdict: { type: "string", enum: ["PASS", "FAIL"] },
            timestamp: { type: "string", description: "ISO time; defaults to now." },
          },
          required: ["id", "target_symbols", "verdict"],
        },
      },
      {
        name: "mimir_query_memory",
        description:
          "Returns a JSON snapshot of ledger rows (capped) for solo inspection without building a full packet.",
        inputSchema: {
          type: "object",
          properties: {
            filter: {
              type: "string",
              enum: ["all", "intents", "validations", "episodes", "subsystems", "traces"],
              description: "Which tables to include.",
            },
            limit: { type: "number", description: "Max rows per table (1–200, default 40)." },
          },
          required: ["filter"],
        },
      },
      {
        name: "mimir_delete_memory",
        description: "Deletes one ledger row by kind and id (cleanup / smoke tests).",
        inputSchema: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["intent", "validation", "episode", "subsystem", "trace"],
            },
            id: {
              type: "string",
              description: "Intent id, validation id, or episode task_id depending on kind.",
            },
          },
          required: ["kind", "id"],
        },
      },
      {
        name: "mimir_recall_similar",
        description:
          "TF–IDF style similarity search over intent descriptions and episode text (offline, no embeddings API). Returns top_k refs with scores.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Natural language query (e.g. failure symptom)." },
            top_k: { type: "number", description: "Number of hits (default 8, max 50)." },
          },
          required: ["query"],
        },
      },
      {
        name: "mimir_apply_ci_result",
        description:
          "Upserts a validation row from CI: verdict + optional provenance. Use with .mimir/ci-mapping.yaml + ci-ingest script, or call directly.",
        inputSchema: {
          type: "object",
          properties: {
            validation_id: { type: "string" },
            verdict: { type: "string", enum: ["PASS", "FAIL", "PENDING"] },
            commit_sha: { type: "string" },
            ci_run_url: { type: "string" },
            ci_run_id: { type: "string" },
          },
          required: ["validation_id", "verdict"],
        },
      },
      {
        name: "mimir_team_ledger_export",
        description: "Returns JSON export of intents + validations for team sharing (paste to file or VCS).",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "mimir_team_ledger_import",
        description: "Merges a prior mimir_team_ledger_export JSON into this DB (INSERT OR REPLACE per row).",
        inputSchema: {
          type: "object",
          properties: {
            ledger_json: { type: "string", description: "Full JSON string from mimir_team_ledger_export." },
          },
          required: ["ledger_json"],
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
      const repoPath = (args as Record<string, unknown>)?.path;
      if (typeof repoPath !== "string" || !repoPath.trim()) {
        throw new Error("mimir_ingest requires a non-empty string path");
      }
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
      const p = args as Record<string, unknown>;
      const task_id = p.task_id;
      const objective = p.objective;
      const task_type = p.task_type;
      const mode = p.mode;
      if (typeof task_id !== "string" || typeof objective !== "string") {
        throw new Error("mimir_build_packet requires task_id and objective strings");
      }
      if (typeof task_type !== "string" || typeof mode !== "string") {
        throw new Error("mimir_build_packet requires task_type and mode strings");
      }
      const symbols = strArr(p.symbols);
      const files = strArr(p.files);
      const pm = p.packet_mode;
      const packetMode: BuildPacketOptions["packetMode"] =
        pm === "delta" ? "delta" : "full";
      const opts: BuildPacketOptions = {
        packetMode,
        includeGitPathDiff: p.include_git_path_diff === true,
      };
      const packetYaml = await memory.build_context_packet(
        task_id,
        objective,
        task_type as TaskType,
        mode as BudgetMode,
        { symbols, files },
        opts
      );
      return { content: [{ type: "text", text: packetYaml }] };
    } 
    
    else if (name === "mimir_expand_handle") {
      const ex = args as Record<string, unknown>;
      const handle = ex.handle;
      const mode = ex.mode;
      if (typeof handle !== "string" || !handle.trim()) {
        throw new Error("mimir_expand_handle requires a non-empty handle string");
      }
      const modes: BudgetMode[] = ["scout", "operate", "investigate", "forensics"];
      if (typeof mode !== "string" || !modes.includes(mode as BudgetMode)) {
        throw new Error("mimir_expand_handle requires mode: scout | operate | investigate | forensics");
      }
      const budget = memory.tokenGovernor.createBudget(mode as BudgetMode);
      const expanded = await memory.expand_handle(handle, budget);
      if (expanded) {
         return { content: [{ type: "text", text: expanded }] };
      } else {
         return { content: [{ type: "text", text: `Handle '${handle}' not found or expansion exceeded token budget for mode '${mode}'.` }] };
      }
    } 
    
    else if (name === "mimir_record_episode") {
      const ep = args as Record<string, unknown>;
      guardSecrets("mimir_record_episode", ep);
      const prov = pickProvenance(ep);
      await memory.record_episode({
        task_id: String(ep.task_id),
        timestamp: new Date().toISOString(),
        objective: String(ep.objective ?? ""),
        assumptions: strArr(ep.assumptions),
        files_touched: strArr(ep.files_touched),
        commands_run: strArr(ep.commands_run),
        outputs_summarized: String(ep.outputs_summarized ?? ""),
        tests_run: strArr(ep.tests_run),
        verdicts: episodeVerdict(ep.verdicts),
        failed_hypotheses: strArr(ep.failed_hypotheses),
        accepted_solution: typeof ep.accepted_solution === "string" ? ep.accepted_solution : undefined,
        residual_risks: strArr(ep.residual_risks),
        next_best_action: String(ep.next_best_action ?? ""),
        provenance: prov,
      });
      return { content: [{ type: "text", text: `Successfully recorded episode for task ${ep.task_id}.` }] };
    } 
    
    else if (name === "mimir_record_decision") {
      const dec = args as Record<string, unknown>;
      guardSecrets("mimir_record_decision", dec);
      const bindingRaw = dec.binding;
      const binding: IntentDecision["binding"] | undefined =
        bindingRaw === "hard" || bindingRaw === "soft" ? bindingRaw : undefined;
      await memory.record_decision({
        id: String(dec.id),
        type: dec.type as IntentDecision["type"],
        description: String(dec.description),
        target_scope: { subsystems: Array.isArray(dec.subsystems) ? (dec.subsystems as string[]) : [] },
        binding,
        reference_url: typeof dec.reference_url === "string" && dec.reference_url.length > 0 ? dec.reference_url : undefined,
      });
      const handlePrefix =
        dec.type === "CONSTRAINT" ? "CONSTRAINT" :
        dec.type === "INVARIANT" ? "INVARIANT" :
        dec.type === "DECISION" ? "DECISION" :
        dec.type === "NON_GOAL" ? "NON_GOAL" : "RULE";
      return { content: [{ type: "text", text: `Successfully recorded decision ${handlePrefix}:${dec.id}.` }] };
    }

    else if (name === "mimir_record_validation") {
      const v = args as Record<string, unknown>;
      const entry: ValidationEntry = {
        id: String(v.id),
        type: v.type as ValidationEntry["type"],
        target_symbols: Array.isArray(v.target_symbols) ? (v.target_symbols as string[]) : [],
        target_files: Array.isArray(v.target_files) ? (v.target_files as string[]) : [],
        known_failure_signatures: Array.isArray(v.known_failure_signatures)
          ? (v.known_failure_signatures as string[])
          : [],
        last_run_verdict: validationVerdict(v.last_run_verdict),
        last_run_timestamp:
          typeof v.last_run_timestamp === "string" && v.last_run_timestamp.length > 0
            ? v.last_run_timestamp
            : new Date().toISOString(),
        provenance: pickProvenance(v),
      };
      guardSecrets("mimir_record_validation", entry);
      await memory.record_validation(entry);
      const packetHandle = entry.type === "TEST" ? `TEST:${entry.id}` : `VERIFIER:${entry.id}`;
      return {
        content: [
          {
            type: "text",
            text: `Successfully recorded validation ${packetHandle} (registry type ${entry.type}).`,
          },
        ],
      };
    }

    else if (name === "mimir_record_subsystem_card") {
      const s = args as Record<string, unknown>;
      guardSecrets("mimir_record_subsystem_card", s);
      const id = String(s.id ?? "");
      if (!id.startsWith("SUBSYSTEM:")) {
        throw new Error("mimir_record_subsystem_card id must start with SUBSYSTEM: (e.g. SUBSYSTEM:Auth)");
      }
      const card: SubsystemCard = {
        id,
        description: String(s.description ?? ""),
        public_api_symbols: strArr(s.public_api_symbols),
        known_invariants: strArr(s.known_invariants),
      };
      await memory.record_subsystem_card(card);
      return { content: [{ type: "text", text: `Successfully recorded subsystem card ${card.id}.` }] };
    }

    else if (name === "mimir_record_trace") {
      const t = args as Record<string, unknown>;
      guardSecrets("mimir_record_trace", t);
      const verdict = t.verdict === "PASS" || t.verdict === "FAIL" ? t.verdict : "FAIL";
      const trace: TraceEntry = {
        id: String(t.id),
        timestamp:
          typeof t.timestamp === "string" && t.timestamp.length > 0
            ? t.timestamp
            : new Date().toISOString(),
        target_symbols: strArr(t.target_symbols),
        verdict,
      };
      await memory.record_trace(trace);
      return { content: [{ type: "text", text: `Successfully recorded trace ${trace.id} (${trace.verdict}).` }] };
    }

    else if (name === "mimir_query_memory") {
      const q = args as Record<string, unknown>;
      const f = q.filter;
      const filter: "all" | "intents" | "validations" | "episodes" | "subsystems" | "traces" =
        f === "intents" ||
        f === "validations" ||
        f === "episodes" ||
        f === "subsystems" ||
        f === "traces" ||
        f === "all"
          ? f
          : "all";
      let limit = typeof q.limit === "number" && !Number.isNaN(q.limit) ? q.limit : 40;
      if (typeof q.limit === "string" && q.limit.trim()) {
        const n = Number(q.limit);
        if (!Number.isNaN(n)) limit = n;
      }
      limit = Math.min(200, Math.max(1, limit));
      const json = await memory.query_memory(filter, limit);
      return { content: [{ type: "text", text: json }] };
    }

    else if (name === "mimir_delete_memory") {
      const d = args as Record<string, unknown>;
      const k = d.kind;
      if (
        k !== "intent" &&
        k !== "validation" &&
        k !== "episode" &&
        k !== "subsystem" &&
        k !== "trace"
      ) {
        throw new Error(
          "mimir_delete_memory requires kind: intent | validation | episode | subsystem | trace"
        );
      }
      const kind = k;
      const id = String(d.id ?? "");
      if (!id.trim()) throw new Error("mimir_delete_memory requires non-empty id");
      await memory.delete_memory(kind, id);
      return { content: [{ type: "text", text: `Deleted ${kind} ${id}.` }] };
    }

    else if (name === "mimir_recall_similar") {
      const r = args as Record<string, unknown>;
      const query = String(r.query ?? "");
      if (!query.trim()) throw new Error("mimir_recall_similar requires query");
      let k = typeof r.top_k === "number" && !Number.isNaN(r.top_k) ? r.top_k : 8;
      k = Math.min(50, Math.max(1, k));
      guardSecrets("mimir_recall_similar", { query });
      const json = await memory.recall_similar(query, k);
      return { content: [{ type: "text", text: json }] };
    }

    else if (name === "mimir_apply_ci_result") {
      const c = args as Record<string, unknown>;
      guardSecrets("mimir_apply_ci_result", c);
      await applyCiResult(memory.storage, {
        validation_id: String(c.validation_id),
        verdict: validationVerdict(c.verdict),
        commit_sha: typeof c.commit_sha === "string" ? c.commit_sha : undefined,
        ci_run_url: typeof c.ci_run_url === "string" ? c.ci_run_url : undefined,
        ci_run_id: typeof c.ci_run_id === "string" ? c.ci_run_id : undefined,
      });
      return {
        content: [
          {
            type: "text",
            text: `Applied CI result for validation ${String(c.validation_id)} (${String(c.verdict)}).`,
          },
        ],
      };
    }

    else if (name === "mimir_team_ledger_export") {
      const json = await memory.team_ledger_export();
      return { content: [{ type: "text", text: json }] };
    }

    else if (name === "mimir_team_ledger_import") {
      const t = args as Record<string, unknown>;
      const ledger_json = t.ledger_json;
      if (typeof ledger_json !== "string" || !ledger_json.trim()) {
        throw new Error("mimir_team_ledger_import requires ledger_json string");
      }
      guardSecrets("mimir_team_ledger_import", { ledger_json });
      await memory.team_ledger_import(ledger_json);
      return { content: [{ type: "text", text: "Team ledger merged into local database." }] };
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
