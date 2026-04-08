/**
 * Optional `.mimir/config.yaml` next to the Mimir install (repo root).
 * Environment variables override file values. Obsidian WIKI is off unless a vault path resolves.
 */
import * as fs from "fs";
import * as path from "path";
import yaml from "js-yaml";

/** Parent of `src/` — Mimir repo root when running from this package. */
export function mimirInstallRoot(): string {
  return path.dirname(__dirname);
}

export interface ObsidianFileSection {
  enabled?: boolean;
  vault_path?: string;
  project_slug?: string;
  mirror_rel?: string;
  base?: string;
}

export interface MimirConfigFile {
  obsidian?: ObsidianFileSection;
}

export interface ObsidianMirrorSettings {
  vaultPath: string | null;
  /** Vault-relative mirror root with `/` (wikilinks). */
  mirrorRel: string;
  projectSlug: string;
}

let fileCache: MimirConfigFile | null | undefined;
let resolvedCache: ObsidianMirrorSettings | null = null;

function configFilePath(): string {
  const override = process.env.MIMIR_CONFIG_PATH?.trim();
  if (override) return path.resolve(override);
  return path.join(mimirInstallRoot(), ".mimir", "config.yaml");
}

function loadConfigFile(): MimirConfigFile {
  if (fileCache !== undefined) return fileCache;
  const fp = configFilePath();
  try {
    const raw = fs.readFileSync(fp, "utf8");
    const doc = yaml.load(raw) as unknown;
    fileCache = doc && typeof doc === "object" ? (doc as MimirConfigFile) : {};
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[mimir] config: failed to read ${fp}:`, e);
    }
    fileCache = {};
  }
  return fileCache;
}

function toPosixRel(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}

function sanitizeSlug(raw: string): string {
  const s = raw
    .replace(/[\/\\:*?"<>|#]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s.slice(0, 120) || "mimir";
}

/** For tests or hot-reload experiments. */
export function clearMimirConfigCache(): void {
  fileCache = undefined;
  resolvedCache = null;
}

function computeObsidianMirrorSettings(): ObsidianMirrorSettings {
  if (process.env.MIMIR_OBSIDIAN_DISABLED === "1") {
    return { vaultPath: null, mirrorRel: defaultMirrorRel("mimir"), projectSlug: "mimir" };
  }

  const file = loadConfigFile().obsidian;
  const envVault = process.env.MIMIR_OBSIDIAN_VAULT_PATH?.trim();

  let vaultPath: string | null = null;
  if (envVault) {
    vaultPath = path.resolve(envVault);
  } else if (file) {
    const fp = file.vault_path?.trim();
    const explicitlyOff = file.enabled === false;
    if (!explicitlyOff && fp) {
      vaultPath = path.resolve(fp);
    }
  }

  const slugFromEnv = process.env.MIMIR_OBSIDIAN_PROJECT_SLUG?.trim();
  const slugFromFile = file?.project_slug?.trim();
  const projectSlug = sanitizeSlug(slugFromEnv || slugFromFile || "mimir");

  const mirrorRelEnv = process.env.MIMIR_OBSIDIAN_MIRROR_REL?.trim();
  const baseEnv = process.env.MIMIR_OBSIDIAN_BASE?.trim();
  const mirrorRelFile = file?.mirror_rel?.trim();
  const baseFile = file?.base?.trim();

  let mirrorRel: string;
  if (mirrorRelEnv) mirrorRel = toPosixRel(mirrorRelEnv);
  else if (baseEnv) mirrorRel = toPosixRel(baseEnv);
  else if (mirrorRelFile) mirrorRel = toPosixRel(mirrorRelFile);
  else if (baseFile) mirrorRel = toPosixRel(baseFile);
  else mirrorRel = defaultMirrorRel(projectSlug);

  return { vaultPath, mirrorRel, projectSlug };
}

function defaultMirrorRel(projectSlug: string): string {
  return `10_KGRAPH/KG/${sanitizeSlug(projectSlug)}`;
}

/**
 * Cached resolved Obsidian WIKI settings (env overrides file).
 * Call `clearMimirConfigCache()` if env or file changes mid-process.
 */
export function getObsidianMirrorSettings(): ObsidianMirrorSettings {
  if (resolvedCache) return resolvedCache;
  resolvedCache = computeObsidianMirrorSettings();
  return resolvedCache;
}

/** @deprecated Use getObsidianMirrorSettings().mirrorRel */
export function mirrorRelFromVaultRoot(): string {
  return getObsidianMirrorSettings().mirrorRel;
}

/** @deprecated Use getObsidianMirrorSettings().projectSlug */
export function projectSlugForWiki(): string {
  return getObsidianMirrorSettings().projectSlug;
}
