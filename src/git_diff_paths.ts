import { execSync } from "child_process";
import { gitExecSyncOptions } from "./platform";

/**
 * Paths changed in the working tree vs `ref` (e.g. last ingested commit SHA).
 * Best-effort; returns [] if not a git repo or ref invalid.
 */
export function gitDiffNameOnlySinceRef(repoRoot: string, ref: string): string[] {
  if (!ref || !ref.trim()) return [];
  try {
    const out = execSync(`git diff --name-only ${ref} --`, gitExecSyncOptions(repoRoot)).trim();
    if (!out) return [];
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}
