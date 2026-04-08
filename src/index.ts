import { StorageLayer } from "./storage";
import { RepoCartographer } from "./cartographer";
import { ContextPacketBuilder } from "./context_builder";
import { TokenGovernor } from "./token_governor";
import { ExpansionResolver } from "./resolver";
import { LifecycleManager } from "./lifecycle";
import { TelemetryIngestor } from "./telemetry";
import {
  TaskType,
  BudgetMode,
  EpisodeEntry,
  ValidationEntry,
  IntentDecision,
  TokenBudget,
  SubsystemCard,
  TraceEntry,
} from "./schemas";
import type { BuildPacketOptions } from "./context_builder";
import {
  exportTeamLedgerJson,
  exportTeamLedgerToFile,
  importTeamLedgerFromFile,
  importTeamLedgerJson,
} from "./team_ledger";
import { recallSimilar as recallSimilarSearch } from "./recall_tfidf";
import {
  syncEpisodeToObsidian,
  syncIntentToObsidian,
  syncSubsystemToObsidian,
  syncTraceToObsidian,
  syncValidationToObsidian,
} from "./obsidian_sync";
import * as path from "path";

export class MemorySystemAPI {
  public storage: StorageLayer;
  public cartographer: RepoCartographer;
  public contextBuilder: ContextPacketBuilder;
  public tokenGovernor: TokenGovernor;
  public resolver: ExpansionResolver;
  public lifecycleManager: LifecycleManager;
  public telemetry: TelemetryIngestor;

  constructor() {
    this.storage = new StorageLayer();
    this.cartographer = new RepoCartographer(this.storage);
    this.tokenGovernor = new TokenGovernor();
    this.contextBuilder = new ContextPacketBuilder(this.storage, this.tokenGovernor);
    this.resolver = new ExpansionResolver(this.storage, this.tokenGovernor);
    this.lifecycleManager = new LifecycleManager(this.storage);
    this.telemetry = new TelemetryIngestor(this.storage);
  }

  async init(dbPath: string = "memory.db") {
    await this.storage.init(dbPath);
    const teamImport = process.env.MIMIR_TEAM_LEDGER_IMPORT?.trim();
    if (teamImport) {
      try {
        await importTeamLedgerFromFile(this.storage, teamImport);
        console.error(`[mimir] imported team ledger from ${teamImport}`);
      } catch (e) {
        console.error(`[mimir] MIMIR_TEAM_LEDGER_IMPORT failed:`, e);
      }
    }
  }

  private async maybeExportTeamLedger(): Promise<void> {
    const p = process.env.MIMIR_TEAM_LEDGER_EXPORT_PATH?.trim();
    if (p) {
      try {
        await exportTeamLedgerToFile(this.storage, p);
      } catch (e) {
        console.error(`[mimir] MIMIR_TEAM_LEDGER_EXPORT_PATH failed:`, e);
      }
    }
  }

  async ingest_repo(path: string): Promise<void> {
    await this.cartographer.ingestRepo(path);
  }

  async record_episode(entry: EpisodeEntry): Promise<void> {
    await this.storage.saveEpisode(entry);
    await syncEpisodeToObsidian(entry);
  }

  async record_validation(result: ValidationEntry): Promise<void> {
    await this.storage.saveValidation(result);
    await syncValidationToObsidian(result);
    await this.maybeExportTeamLedger();
  }

  async record_decision(decision: IntentDecision): Promise<void> {
    await this.storage.saveIntent(decision);
    await syncIntentToObsidian(decision);
    await this.maybeExportTeamLedger();
  }

  async build_context_packet(
    taskId: string,
    objective: string,
    taskType: TaskType,
    mode: BudgetMode,
    targetScope: { symbols: string[]; files: string[] },
    options?: BuildPacketOptions
  ): Promise<string> {
    return await this.contextBuilder.build(taskId, objective, taskType, mode, targetScope, options);
  }

  async recall_similar(query: string, top_k: number): Promise<string> {
    const hits = await recallSimilarSearch(this.storage, query, top_k);
    return JSON.stringify({ query, top_k, hits }, null, 2);
  }

  async team_ledger_export(): Promise<string> {
    return exportTeamLedgerJson(this.storage);
  }

  async team_ledger_import(json: string): Promise<void> {
    await importTeamLedgerJson(this.storage, json);
    await this.maybeExportTeamLedger();
  }

  async expand_handle(handle: string, budget: TokenBudget): Promise<string | null> {
    return await this.resolver.expandHandle(handle, budget);
  }

  async invalidate_stale_memory(changedPaths: string[]): Promise<void> {
    await this.lifecycleManager.invalidateStaleMemory(changedPaths);
  }

  /** JSON snapshot of ledger rows for solo inspection (capped). */
  async query_memory(
    filter: "all" | "intents" | "validations" | "episodes" | "subsystems" | "traces",
    limit: number
  ): Promise<string> {
    const lim = Math.min(Math.max(1, limit), 200);
    const out: Record<string, unknown> = {};
    if (filter === "all" || filter === "intents") {
      const rows = await this.storage.getIntents();
      out.intents = rows.slice(0, lim);
      out.intents_omitted = Math.max(0, rows.length - lim);
    }
    if (filter === "all" || filter === "validations") {
      const rows = await this.storage.getValidations();
      out.validations = rows.slice(0, lim);
      out.validations_omitted = Math.max(0, rows.length - lim);
    }
    if (filter === "all" || filter === "episodes") {
      const rows = await this.storage.getEpisodes();
      const sorted = [...rows].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
      out.episodes = sorted.slice(0, lim);
      out.episodes_omitted = Math.max(0, sorted.length - lim);
    }
    if (filter === "all" || filter === "subsystems") {
      const rows = await this.storage.getSubsystemCards();
      out.subsystems = rows.slice(0, lim);
      out.subsystems_omitted = Math.max(0, rows.length - lim);
    }
    if (filter === "all" || filter === "traces") {
      const rows = await this.storage.getTraces();
      const sorted = [...rows].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
      out.traces = sorted.slice(0, lim);
      out.traces_omitted = Math.max(0, sorted.length - lim);
    }
    return JSON.stringify(out, null, 2);
  }

  async delete_memory(
    kind: "intent" | "validation" | "episode" | "subsystem" | "trace",
    id: string
  ): Promise<void> {
    if (kind === "intent") await this.storage.deleteIntent(id);
    else if (kind === "validation") await this.storage.deleteValidation(id);
    else if (kind === "episode") await this.storage.deleteEpisode(id);
    else if (kind === "subsystem") await this.storage.deleteSubsystemCard(id);
    else await this.storage.deleteTrace(id);
  }

  async record_subsystem_card(card: SubsystemCard): Promise<void> {
    await this.storage.saveSubsystemCard(card);
    await syncSubsystemToObsidian(card);
  }

  async record_trace(trace: TraceEntry): Promise<void> {
    await this.telemetry.ingestExecutionTrace(trace);
    await syncTraceToObsidian(trace);
  }
}

// ---------------------------------------------------------------------
// DEMO AND PROOF
// ---------------------------------------------------------------------

async function demo() {
  console.log("=== Initializing Mimir V2 Memory System ===");
  const memory = new MemorySystemAPI();
  await memory.init(":memory:"); // In-memory DB for demo

  const indexFile = path.join(__dirname, "index.ts");
  const scopedMemoryClass = "SYMBOL:index.ts::MemorySystemAPI";

  console.log("\n1. Setting up Intent Ledger (Constitutional Rules)");
  await memory.record_decision({
    id: "PUBLIC_API_IMMUTABLE",
    type: "RULE",
    description: "Do not change public API signatures without deprecation warning.",
    target_scope: { subsystems: ["auth", "api"] }
  });

  console.log("\n2. Setting up Episodic & Validation Memory");
  await memory.record_validation({
    id: "auth_reconnect_integration",
    type: "TEST",
    target_symbols: [scopedMemoryClass],
    target_files: [indexFile],
    known_failure_signatures: ["TokenExpiredError"],
    last_run_verdict: "PASS",
    last_run_timestamp: new Date().toISOString()
  });

  // Adding multiple similar failures to test Episodic Consolidation
  await memory.record_episode({
    task_id: "A17",
    timestamp: new Date().toISOString(),
    objective: "Fix token refresh on resume",
    assumptions: ["Network is always available"],
    files_touched: [indexFile],
    commands_run: ["npm test"],
    outputs_summarized: "Test failed with timeout",
    tests_run: ["auth_reconnect_integration"],
    verdicts: "FAIL",
    failed_hypotheses: ["Adding a delay before refresh fixes it"],
    residual_risks: [],
    next_best_action: "Investigate token state"
  });
  
  await memory.record_episode({
    task_id: "A18",
    timestamp: new Date().toISOString(),
    objective: "Fix token refresh on resume again",
    assumptions: [],
    files_touched: [indexFile],
    commands_run: ["npm test"],
    outputs_summarized: "Test failed with timeout",
    tests_run: ["auth_reconnect_integration"],
    verdicts: "FAIL",
    failed_hypotheses: ["Adding a delay before refresh fixes it"], // REPEATED HYPOTHESIS
    residual_risks: [],
    next_best_action: "Stop using delay"
  });

  console.log("\n3. Ingesting Repository (AST Extraction + CodeRank pass)");
  await memory.ingest_repo(__dirname); 

  console.log("\n3.5. Ingesting Runtime Telemetry (Execution Traces)");
  await memory.telemetry.ingestExecutionTrace({
    id: "TRACE_1",
    timestamp: new Date().toISOString(),
    target_symbols: [scopedMemoryClass],
    verdict: "FAIL"
  });

  console.log("\n4. Building SCOUT Context Packet (YAML Format + CodeRank Pruning)");
  const packetYaml = await memory.build_context_packet(
    "T001",
    "Fix bug where MemorySystemAPI fails to build context after ingest.",
    "bug_fix",
    "scout",
    {
      symbols: [scopedMemoryClass],
      files: [indexFile]
    }
  );

  console.log("\n--- SCOUT Context Packet (YAML) ---");
  console.log(packetYaml);

  console.log("\n5. Running Episodic Consolidation (Background GC)");
  await memory.lifecycleManager.runEpisodicConsolidation();
  const intents = await memory.storage.getIntents();
  console.log("Synthesized Rules from repeated failures:");
  console.log(intents.filter(i => i.id.startsWith("AUTO_RULE")));

  console.log("\n6. Simulating Repo Change (Blast-Radius Cascade Invalidation)");
  console.log("Invalidating memory for schemas.ts...");
  await memory.invalidate_stale_memory([path.join(__dirname, "schemas.ts")]);
  
  console.log("\n=== V2 Demo Completed ===");
}

if (require.main === module) {
  demo().catch(console.error);
}
