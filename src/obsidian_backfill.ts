/**
 * Replay ledger rows from SQLite into the Obsidian WIKI mirror (idempotent overwrites).
 */
import type { StorageLayer } from "./storage";
import { clearMimirConfigCache, getObsidianMirrorSettings } from "./mimir_config";
import {
  ensureObsidianMirrorScaffold,
  syncEpisodeToObsidian,
  syncIntentToObsidian,
  syncSubsystemToObsidian,
  syncTraceToObsidian,
  syncValidationToObsidian,
} from "./obsidian_sync";

export interface ObsidianBackfillCounts {
  intents: number;
  validations: number;
  subsystems: number;
  traces: number;
  episodes: number;
}

/** Call when env/config may have changed since process start. */
export function refreshObsidianConfigCache(): void {
  clearMimirConfigCache();
}

export async function backfillObsidianWiki(storage: StorageLayer): Promise<ObsidianBackfillCounts> {
  const s = getObsidianMirrorSettings();
  if (!s.vaultPath) {
    throw new Error(
      "Obsidian WIKI not configured: add obsidian.vault_path to .mimir/config.yaml (copy from config.example.yaml) or set MIMIR_OBSIDIAN_VAULT_PATH"
    );
  }

  await ensureObsidianMirrorScaffold();

  const counts: ObsidianBackfillCounts = {
    intents: 0,
    validations: 0,
    subsystems: 0,
    traces: 0,
    episodes: 0,
  };

  for (const d of await storage.getIntents()) {
    await syncIntentToObsidian(d);
    counts.intents++;
  }
  for (const v of await storage.getValidations()) {
    await syncValidationToObsidian(v);
    counts.validations++;
  }
  for (const c of await storage.getSubsystemCards()) {
    await syncSubsystemToObsidian(c);
    counts.subsystems++;
  }
  for (const t of await storage.getTraces()) {
    await syncTraceToObsidian(t);
    counts.traces++;
  }
  const episodes = await storage.getEpisodes();
  episodes.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  for (const e of episodes) {
    await syncEpisodeToObsidian(e);
    counts.episodes++;
  }

  return counts;
}
