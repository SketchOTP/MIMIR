/**
 * Skip build artifacts and dependency trees so CodeRank focuses on source.
 */

const SEGMENTS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
  "__generated__",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  ".mypy_cache",
]);

export function shouldExcludeFromIngest(absPath: string): boolean {
  const norm = absPath.replace(/\\/g, "/").toLowerCase();
  if (norm.endsWith(".min.js") || norm.endsWith(".min.ts")) return true;
  const parts = norm.split("/");
  for (const p of parts) {
    if (SEGMENTS.has(p)) return true;
    if (p.endsWith(".egg-info")) return true;
  }
  return false;
}
