import * as fs from "fs/promises";
import * as path from "path";
import { StorageLayer } from "./storage";
import { ValidationEntry } from "./schemas";

export type CiMappingFile = {
  validations?: { ci_job_name: string; validation_id: string }[];
};

export async function loadCiMapping(repoRoot: string): Promise<CiMappingFile> {
  const f = path.join(repoRoot, ".mimir", "ci-mapping.yaml");
  try {
    const yaml = await import("js-yaml");
    const raw = await fs.readFile(f, "utf8");
    return yaml.load(raw) as CiMappingFile;
  } catch {
    return {};
  }
}

export function resolveValidationIdFromJob(mapping: CiMappingFile, jobName: string): string | null {
  const rows = mapping.validations || [];
  const hit = rows.find((r) => r.ci_job_name === jobName);
  return hit?.validation_id ?? null;
}

/** Apply CI outcome to validation_registry (upsert by id). */
export async function applyCiResult(
  storage: StorageLayer,
  params: {
    validation_id: string;
    verdict: ValidationEntry["last_run_verdict"];
    commit_sha?: string;
    ci_run_url?: string;
    ci_run_id?: string;
  }
): Promise<void> {
  const existing = (await storage.getValidations()).find((v) => v.id === params.validation_id);
  const entry: ValidationEntry = {
    id: params.validation_id,
    type: existing?.type ?? "TEST",
    target_symbols: existing?.target_symbols ?? [],
    target_files: existing?.target_files ?? [],
    known_failure_signatures: existing?.known_failure_signatures ?? [],
    last_run_verdict: params.verdict,
    last_run_timestamp: new Date().toISOString(),
    provenance: {
      ...(existing?.provenance || {}),
      commit_sha: params.commit_sha ?? existing?.provenance?.commit_sha,
      ci_run_url: params.ci_run_url ?? existing?.provenance?.ci_run_url,
      ci_run_id: params.ci_run_id ?? existing?.provenance?.ci_run_id,
    },
  };
  await storage.saveValidation(entry);
}
