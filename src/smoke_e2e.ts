/**
 * End-to-end smoke: MemorySystemAPI + storage migrations + ingest + packet + GC + secrets.
 * Run: npx ts-node src/smoke_e2e.ts
 */
import * as fs from "fs";
import * as os from "os";
import * as yaml from "js-yaml";
import * as path from "path";
import { MemorySystemAPI } from "./index";
import { scanRecordedPayload } from "./secrets";
import { readLiveGitHead } from "./git_util";

let failures = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`[OK] ${name}${detail ? `: ${detail}` : ""}`);
  } else {
    console.error(`[FAIL] ${name}${detail ? `: ${detail}` : ""}`);
    failures++;
  }
}

async function main() {
  console.log("=== Mimir smoke_e2e ===\n");

  // --- Secrets (MCP layer uses same module) ---
  const clean = scanRecordedPayload("t", { description: "no secrets here" });
  ok("secrets rejects clean payload", clean.ok === true);
  // Pattern: sk- + 20+ alphanumeric (not sk-proj-...)
  const badKey = "sk-" + "a".repeat(22);
  const leaked = scanRecordedPayload("t", { description: badKey });
  ok("secrets blocks OpenAI-style key", leaked.ok === false);
  process.env.MIMIR_ALLOW_UNSAFE_SECRET_RECORDING = "1";
  const bypass = scanRecordedPayload("t", { x: badKey });
  ok("secrets bypass with env", bypass.ok === true);
  delete process.env.MIMIR_ALLOW_UNSAFE_SECRET_RECORDING;

  const dbFile = path.join(os.tmpdir(), `mimir-smoke-${Date.now()}.db`);
  try {
  const memory = new MemorySystemAPI();
  await memory.init(dbFile);

  const dupDesc =
    "duplicate intent description for smoke test only filler text abcdef";
  await memory.record_decision({
    id: "SMOKE_DUP_A",
    type: "RULE",
    description: dupDesc,
    target_scope: {},
    binding: "soft",
  });
  await memory.record_decision({
    id: "SMOKE_DUP_B",
    type: "RULE",
    description: dupDesc,
    target_scope: {},
    binding: "soft",
  });

  await memory.record_decision({
    id: "SMOKE_HARD",
    type: "CONSTRAINT",
    description: "constitutional constraint for smoke",
    target_scope: { subsystems: ["smoke"] },
    binding: "hard",
    reference_url: "https://example.com/adr-smoke",
  });

  await memory.record_validation({
    id: "SMOKE_TEST_1",
    type: "TEST",
    target_symbols: ["SYMBOL:smoke.ts::X"],
    target_files: ["smoke.ts"],
    known_failure_signatures: [],
    last_run_verdict: "PASS",
    last_run_timestamp: new Date().toISOString(),
    provenance: { commit_sha: "abc1234", ci_run_id: "run-1" },
  });

  await memory.record_validation({
    id: "SMOKE_VER_1",
    type: "VERIFIER",
    target_symbols: [],
    target_files: [],
    known_failure_signatures: [],
    last_run_verdict: "PENDING",
    last_run_timestamp: new Date().toISOString(),
  });

  await memory.record_episode({
    task_id: "SMOKE_EP_1",
    timestamp: new Date().toISOString(),
    objective: "first smoke episode",
    assumptions: [],
    files_touched: [],
    commands_run: [],
    outputs_summarized: "ok",
    tests_run: ["SMOKE_TEST_1"],
    verdicts: "PASS",
    failed_hypotheses: [],
    residual_risks: [],
    next_best_action: "none",
    provenance: { repo_head_at_close: "deadbeef", ci_run_url: "https://ci.example/job/1" },
  });

  const repoRoot = path.join(__dirname, "..");
  await memory.ingest_repo(repoRoot);

  const nodeCount = await memory.storage.countStructuralNodes();
  ok("ingest produced graph nodes", nodeCount > 0, `count=${nodeCount}`);

  const metaHead = await memory.storage.getMetadata("git_head");
  const live = readLiveGitHead(repoRoot);
  ok("git metadata present or skipped", metaHead !== undefined);
  if (live && metaHead && metaHead.length > 0) {
    ok("live git head matches ingest metadata", live === metaHead, `${live?.slice(0, 7)}`);
  }

  const packetYaml = await memory.build_context_packet(
    "T-smoke",
    "smoke test objective mentions duplicate and constraint",
    "bug_fix",
    "scout",
    { symbols: ["MemorySystemAPI"], files: [path.join(repoRoot, "src", "index.ts")] }
  );

  const packet = yaml.load(packetYaml) as Record<string, unknown>;
  const sel = packet.selection_meta as Record<string, unknown> | undefined;
  const fresh = sel?.ingest_freshness as Record<string, unknown> | undefined;
  ok("packet has ingest_freshness", !!fresh);
  if (fresh) {
    ok("ingest_freshness graph_matches_ingest_head", fresh.graph_matches_ingest_head === true);
  }

  const oq = packet.open_questions as string[] | undefined;
  ok("open_questions lists duplicate intents", Array.isArray(oq) && oq.some((s) => s.includes("Similar intent")));

  const constraints = packet.constraints as string[] | undefined;
  ok("hard constraint appears in packet", Array.isArray(constraints) && constraints.some((c) => c.includes("SMOKE_HARD")));

  const budget = memory.tokenGovernor.createBudget("scout");
  const nodes = await memory.storage.getStructuralNodes();
  const fileNode = nodes.find((n) => n.type === "FILE" && n.path.includes("index.ts"));
  const symNode = nodes.find((n) => n.type === "SYMBOL" && n.id.includes("index.ts"));

  if (fileNode) {
    const ex = await memory.expand_handle(fileNode.id, budget);
    ok("expand FILE", !!ex && ex.includes("FILE"));
  } else ok("expand FILE", false, "no index.ts FILE node");

  if (symNode) {
    const ex = await memory.expand_handle(symNode.id, budget);
    ok("expand SYMBOL", !!ex && ex.includes("SYMBOL"));
  } else ok("expand SYMBOL", false, "no symbol from index.ts");

  const exRule = await memory.expand_handle("RULE:SMOKE_DUP_A", budget);
  ok("expand RULE", !!exRule && exRule.includes("SMOKE_DUP_A"));

  const exTest = await memory.expand_handle("TEST:SMOKE_TEST_1", budget);
  ok("expand TEST + provenance", !!exTest && exTest.includes("commit_sha"));

  const qjson = await memory.query_memory("all", 50);
  ok("query_memory returns JSON", qjson.includes("SMOKE_TEST_1") && qjson.includes("intents"));

  await memory.delete_memory("validation", "SMOKE_VER_1");
  const valsAfter = await memory.storage.getValidations();
  ok("delete_memory validation", !valsAfter.some((v) => v.id === "SMOKE_VER_1"));

  await memory.record_episode({
    task_id: "SMOKE_GC_1",
    timestamp: new Date().toISOString(),
    objective: "gc probe a",
    assumptions: [],
    files_touched: [],
    commands_run: [],
    outputs_summarized: "fail",
    tests_run: [],
    verdicts: "FAIL",
    failed_hypotheses: ["smoke_repeat_hypothesis_xyz"],
    residual_risks: [],
    next_best_action: "retry",
  });
  await memory.record_episode({
    task_id: "SMOKE_GC_2",
    timestamp: new Date().toISOString(),
    objective: "gc probe b",
    assumptions: [],
    files_touched: [],
    commands_run: [],
    outputs_summarized: "fail",
    tests_run: [],
    verdicts: "FAIL",
    failed_hypotheses: ["smoke_repeat_hypothesis_xyz"],
    residual_risks: [],
    next_best_action: "retry",
  });

  await memory.lifecycleManager.runEpisodicConsolidation();
  const intentsAfterGc = await memory.storage.getIntents();
  ok("GC created AUTO_RULE", intentsAfterGc.some((i) => i.id.startsWith("AUTO_RULE")));

  await memory.delete_memory("intent", "SMOKE_DUP_A");
  ok("delete_memory intent", !(await memory.storage.getIntents()).some((i) => i.id === "SMOKE_DUP_A"));

  console.log(failures === 0 ? "\n=== ALL SMOKE CHECKS PASSED ===" : "\n=== SMOKE FAILED ===");
  } finally {
    try {
      fs.unlinkSync(dbFile);
    } catch {
      /* ignore */
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
