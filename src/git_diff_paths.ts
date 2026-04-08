import { execGitOutput } from "./platform";

/**
 * Paths changed in the working tree vs `ref` (e.g. last ingested commit SHA).
 * Best-effort; returns [] if not a git repo or ref invalid.
 */
export function gitDiffNameOnlySinceRef(repoRoot: string, ref: string): string[] {
  if (!ref || !ref.trim()) return [];
  try {
    const out = execGitOutput(`git diff --name-only ${ref} --`, repoRoot);
    if (!out) return [];
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}
