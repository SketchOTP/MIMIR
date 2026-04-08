/**
 * CI helper: map GITHUB_JOB (or MIMIR_VALIDATION_ID) to a validation row.
 * Usage: MIMIR_DB_PATH=/path/mimir.db node -r ts-node/register src/ci_ingest_main.ts <repo_root>
 * Env: GITHUB_JOB, MIMIR_VALIDATION_ID, CI_VERDICT (PASS|FAIL|PENDING), optional GITHUB_SHA, GITHUB_RUN_ID, CI_RUN_URL
 */
import * as path from "path";
import { MemorySystemAPI } from "./index";
import { applyCiResult, loadCiMapping, resolveValidationIdFromJob } from "./ci_apply";
import { resolveMcpDbPath } from "./mcp_db_path";

function dbPath(): string {
  return process.env.MIMIR_DB_PATH?.trim() || resolveMcpDbPath();
}

async function main() {
  const repoRoot = path.resolve(process.argv[2] || process.cwd());
  const verdictRaw = (process.env.CI_VERDICT || "PENDING").toUpperCase();
  const verdict =
    verdictRaw === "PASS" || verdictRaw === "FAIL" || verdictRaw === "PENDING" ? verdictRaw : "PENDING";

  let validationId = process.env.MIMIR_VALIDATION_ID?.trim();
  if (!validationId) {
    const job = process.env.GITHUB_JOB || process.env.CI_JOB_NAME || "";
    const mapping = await loadCiMapping(repoRoot);
    validationId = resolveValidationIdFromJob(mapping, job) || "";
  }
  if (!validationId) {
    console.error("Set MIMIR_VALIDATION_ID or add .mimir/ci-mapping.yaml for GITHUB_JOB.");
    process.exit(1);
  }

  const memory = new MemorySystemAPI();
  await memory.init(dbPath());

  await applyCiResult(memory.storage, {
    validation_id: validationId,
    verdict,
    commit_sha: process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA,
    ci_run_id: process.env.GITHUB_RUN_ID || process.env.CI_RUN_ID,
    ci_run_url: process.env.CI_RUN_URL || process.env.GITHUB_SERVER_URL,
  });

  console.log(`Applied CI result for validation ${validationId}: ${verdict}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
