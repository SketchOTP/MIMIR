import { execSync } from "child_process";

/** Best-effort current HEAD for a repo on disk (same machine as MCP). */
export function readLiveGitHead(repoRoot: string): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}
