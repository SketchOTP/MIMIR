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
  /** H1 title for `01_PROJECTS/<slug>.md` (default: slug). */
  project_name?: string;
  /** Path to README to embed in the project note: absolute, or relative to Mimir install root. */
  readme_path?: string;
  mirror_rel?: string;
  base?: string;
}

export interface MimirConfigFile {
  obsidian?: ObsidianFileSection;
}

export interface ObsidianMirrorSettings {
  vaultPath: string | null;
  /** Vault-relative mirror root with `/` (wikilinks). Default `KGRAPH/<slug>/`. */
  mirrorRel: string;
  projectSlug: string;
  /** Display title for `01_PROJECTS/<slug>.md` H1. */
  projectDisplayName: string;
  /** Absolute path to README to embed in project note, if the file exists. */
  readmeAbsPath: string | null;
}

let fileCache: MimirConfigFile | undefined;
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

function resolveReadmeAbsPath(file: ObsidianFileSection | undefined): string | null {
  const env = process.env.MIMIR_OBSIDIAN_README_PATH?.trim();
  if (env) {
    const p = path.resolve(env);
    return fs.existsSync(p) ? p : null;
  }
  const rp = file?.readme_path?.trim();
  if (rp) {
    const p = path.isAbsolute(rp) ? path.resolve(rp) : path.join(mimirInstallRoot(), rp);
    return fs.existsSync(p) ? p : null;
  }
  const def = path.join(mimirInstallRoot(), "README.md");
  return fs.existsSync(def) ? def : null;
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
    return {
      vaultPath: null,
      mirrorRel: defaultMirrorRel("mimir"),
      projectSlug: "mimir",
      projectDisplayName: "mimir",
      readmeAbsPath: null,
    };
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

  const displayFromEnv = process.env.MIMIR_OBSIDIAN_PROJECT_NAME?.trim();
  const displayFromFile = file?.project_name?.trim();
  const projectDisplayName = displayFromEnv || displayFromFile || projectSlug;

  const readmeAbsPath = resolveReadmeAbsPath(file);

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

  return { vaultPath, mirrorRel, projectSlug, projectDisplayName, readmeAbsPath };
}

function defaultMirrorRel(projectSlug: string): string {
  return `KGRAPH/${sanitizeSlug(projectSlug)}`;
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
