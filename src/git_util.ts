import { execSync } from "child_process";
import { gitExecSyncOptions } from "./platform";

/** Best-effort current HEAD for a repo on disk (same machine as MCP). */
export function readLiveGitHead(repoRoot: string): string | null {
  try {
    return execSync("git rev-parse HEAD", gitExecSyncOptions(repoRoot)).trim();
  } catch {
    return null;
  }
}
