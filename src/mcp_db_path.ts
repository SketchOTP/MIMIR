import * as path from "path";

/** Stable DB location: default is <MIMIR repo root>/mimir.db (parent of src/), not process.cwd(). */
export function resolveMcpDbPath(): string {
  const fromEnv = process.env.MIMIR_DB_PATH?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(path.dirname(__dirname), "mimir.db");
}
