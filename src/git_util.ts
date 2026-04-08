import { execGitOutput } from "./platform";

/** Best-effort current HEAD for a repo on disk (same machine as MCP). */
export function readLiveGitHead(repoRoot: string): string | null {
  try {
    return execGitOutput("git rev-parse HEAD", repoRoot);
  } catch {
    return null;
  }
}
