/**
 * CLI: backfill Obsidian WIKI from SQLite.
 * Usage: npm run obsidian-backfill -- [path/to/mimir.db]
 * Env/config: same as MCP (.mimir/config.yaml or MIMIR_OBSIDIAN_VAULT_PATH).
 */
import { StorageLayer } from "./storage";
import { resolveMcpDbPath } from "./mcp_db_path";
import { backfillObsidianWiki, refreshObsidianConfigCache } from "./obsidian_backfill";
import * as path from "path";

async function main() {
  refreshObsidianConfigCache();
  const dbArg = process.argv[2]?.trim();
  const dbPath = dbArg ? path.resolve(dbArg) : resolveMcpDbPath();
  console.error(`[mimir] obsidian-backfill: database ${dbPath}`);

  const storage = new StorageLayer();
  await storage.init(dbPath);

  const counts = await backfillObsidianWiki(storage);
  console.log(JSON.stringify({ ok: true, database: dbPath, ...counts }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
