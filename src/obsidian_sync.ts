/**
 * Optional WIKI mirror: Markdown + wikilinks under the Obsidian vault.
 * SQLite (mimir.db) remains the source of truth; vault is for reading, graph, and manual notes.
 */
import * as fs from "fs/promises";
import * as path from "path";
import yaml from "js-yaml";
import type { EpisodeEntry, IntentDecision, SubsystemCard, TraceEntry, ValidationEntry } from "./schemas";
import { getObsidianMirrorSettings } from "./mimir_config";

function vaultPath(): string | null {
  return getObsidianMirrorSettings().vaultPath;
}

function mirrorAbs(vault: string, baseRel: string): string {
  return path.join(vault, ...baseRel.split("/").filter(Boolean));
}

/** Safe single path segment for filenames (not full paths). */
export function sanitizeSegment(raw: string): string {
  const s = raw
    .replace(/[\/\\:*?"<>|#]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s.slice(0, 120) || "unnamed";
}

function wikilink(relPathWithoutMd: string, label?: string): string {
  const target = relPathWithoutMd.replace(/\\/g, "/");
  return label ? `[[${target}|${label}]]` : `[[${target}]]`;
}

function fmBlock(data: Record<string, unknown>): string {
  const body = yaml.dump(data, { lineWidth: 120, noRefs: true }).trimEnd();
  return `---\n${body}\n---\n\n`;
}

async function writeNote(absDir: string, fileBase: string, frontmatter: Record<string, unknown>, mdBody: string): Promise<void> {
  await fs.mkdir(absDir, { recursive: true });
  const fp = path.join(absDir, `${fileBase}.md`);
  await fs.writeFile(fp, fmBlock(frontmatter) + mdBody, "utf8");
}

async function appendToTaskHub(
  vault: string,
  baseRel: string,
  taskId: string,
  episodeRelNoExt: string,
  episodeLabel: string
): Promise<void> {
  const root = mirrorAbs(vault, baseRel);
  const safe = sanitizeSegment(taskId);
  const taskDir = path.join(root, "Tasks");
  const taskFile = path.join(taskDir, `${safe}.md`);
  const epLink = wikilink(`${baseRel}/Episodes/${episodeRelNoExt}`, episodeLabel);
  try {
    const existing = await fs.readFile(taskFile, "utf8");
    if (existing.includes(episodeRelNoExt)) return;
    await fs.writeFile(taskFile, `${existing.trimEnd()}\n\n- ${epLink}\n`, "utf8");
  } catch {
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(
      taskFile,
      fmBlock({
        tags: ["mimir/task"],
        mimir_kind: "task",
        mimir_task_id: taskId,
      }) + `# Task — ${taskId}\n\n## Episodes\n\n- ${epLink}\n\n${footerMOC(baseRel)}`,
      "utf8"
    );
  }
}

function footerMOC(baseRel: string): string {
  return `\n---\n${wikilink(`${baseRel}/MOC`, "← Mimir WIKI MOC")}\n`;
}

async function ensureProjectStub(vault: string, baseRel: string, slug: string): Promise<void> {
  const projectsDir = path.join(vault, "01_PROJECTS");
  const note = path.join(projectsDir, `${slug}.md`);
  try {
    await fs.access(note);
  } catch {
    await fs.mkdir(projectsDir, { recursive: true });
    const body = `# ${slug}

Mimir **WIKI** mirror for this project (human-readable). **SQLite (\`mimir.db\`) is canonical** for MCP tools, packets, and graph index.

## Knowledge graph (automated notes)

- ${wikilink(`${baseRel}/MOC`, "MOC — map of mirrored memory")}

Folders under \`${baseRel}/\`: \`Episodes/\`, \`Tasks/\`, \`Intents/\`, \`Validations/\`, \`Subsystems/\`, \`Traces/\`.

tags: #mimir/project #mimir/wiki
`;
    await fs.writeFile(
      note,
      fmBlock({
        tags: ["mimir/project", "mimir/wiki"],
        mimir_kind: "project_stub",
        mimir_project_slug: slug,
      }) + body,
      "utf8"
    );
  }
}

async function ensureMOC(vault: string, baseRel: string, slug: string): Promise<void> {
  const root = mirrorAbs(vault, baseRel);
  const mocFile = path.join(root, "MOC.md");
  try {
    await fs.access(mocFile);
  } catch {
    await fs.mkdir(root, { recursive: true });
    const body = `# Mimir WIKI — ${slug}

**SQLite is the source of truth.** This tree is an **Obsidian-facing mirror** (graph, search, backlinks).

## Structure

- **Episodes** — \`mimir_record_episode\`
- **Tasks** — hub per \`task_id\`, links to episodes
- **Intents / Validations / Subsystems / Traces** — ledger rows

## Project registry

- ${wikilink(`01_PROJECTS/${slug}`, `01_PROJECTS — ${slug}`)}

tags: #mimir/moc #mimir/wiki

---

Config: \`.mimir/config.yaml\` (see \`config.example.yaml\`) or env \`MIMIR_OBSIDIAN_VAULT_PATH\`, \`MIMIR_OBSIDIAN_PROJECT_SLUG\`, \`MIMIR_OBSIDIAN_MIRROR_REL\` / \`MIMIR_OBSIDIAN_BASE\`.
`;
    await fs.writeFile(mocFile, fmBlock({ tags: ["mimir/moc", "mimir/wiki"], mimir_project_slug: slug }) + body, "utf8");
  }
}

async function prepareMirror(vault: string): Promise<{ baseRel: string; slug: string }> {
  const s = getObsidianMirrorSettings();
  const baseRel = s.mirrorRel;
  const slug = s.projectSlug;
  await ensureProjectStub(vault, baseRel, slug);
  await ensureMOC(vault, baseRel, slug);
  return { baseRel, slug };
}

export async function syncEpisodeToObsidian(entry: EpisodeEntry): Promise<void> {
  const vault = vaultPath();
  if (!vault) return;
  try {
    const { baseRel } = await prepareMirror(vault);
    const safeTask = sanitizeSegment(entry.task_id);
    const tsSlug = entry.timestamp.replace(/[:.]/g, "-");
    const epBase = `${tsSlug}-${safeTask}`;
    const root = mirrorAbs(vault, baseRel);
    const epDir = path.join(root, "Episodes");
    const testsLinks =
      entry.tests_run.length > 0
        ? entry.tests_run.map((t) => `- ${wikilink(`${baseRel}/Validations/${sanitizeSegment(t)}`, t)}`).join("\n")
        : "_none_";

    const body = `# Episode — ${entry.task_id}

**Verdict:** \`${entry.verdicts}\` · **When:** ${entry.timestamp}

**Task hub:** ${wikilink(`${baseRel}/Tasks/${safeTask}`, entry.task_id)}

## Objective

${entry.objective}

## Summary

${entry.outputs_summarized}

## Assumptions

${entry.assumptions.length ? entry.assumptions.map((a) => `- ${a}`).join("\n") : "_none_"}

## Failed hypotheses

${entry.failed_hypotheses.length ? entry.failed_hypotheses.map((h) => `- ${h}`).join("\n") : "_none_"}

## Files touched

${entry.files_touched.length ? entry.files_touched.map((f) => `- \`${f}\``).join("\n") : "_none_"}

## Commands

${entry.commands_run.length ? entry.commands_run.map((c) => `- \`${c}\``).join("\n") : "_none_"}

## Tests / validations referenced

${testsLinks}

## Next action

${entry.next_best_action}

## Residual risks

${entry.residual_risks.length ? entry.residual_risks.map((r) => `- ${r}`).join("\n") : "_none_"}

${entry.accepted_solution ? `## Accepted solution\n\n${entry.accepted_solution}\n` : ""}
${footerMOC(baseRel)}
`;

    await writeNote(epDir, epBase, { tags: ["mimir/episode"], mimir_kind: "episode", mimir_task_id: entry.task_id, verdict: entry.verdicts }, body);
    await appendToTaskHub(vault, baseRel, entry.task_id, epBase, entry.timestamp);
  } catch (e) {
    console.error("[mimir] Obsidian sync (episode) failed:", e);
  }
}

export async function syncIntentToObsidian(d: IntentDecision): Promise<void> {
  const vault = vaultPath();
  if (!vault) return;
  try {
    const { baseRel } = await prepareMirror(vault);
    const idSafe = sanitizeSegment(d.id);
    const dir = path.join(mirrorAbs(vault, baseRel), "Intents");
    const scopeYaml = yaml.dump(d.target_scope, { lineWidth: 100 }).trimEnd();
    const body = `# Intent — ${d.id}

**Type:** \`${d.type}\` · **Binding:** \`${d.binding ?? "soft"}\`

## Description

${d.description}

## Scope

\`\`\`yaml
${scopeYaml}
\`\`\`

${d.reference_url ? `## Reference\n\n${d.reference_url}\n` : ""}
${footerMOC(baseRel)}
`;
    await writeNote(dir, idSafe, { tags: ["mimir/intent"], mimir_kind: "intent", mimir_id: d.id, mimir_type: d.type }, body);
  } catch (e) {
    console.error("[mimir] Obsidian sync (intent) failed:", e);
  }
}

export async function syncValidationToObsidian(v: ValidationEntry): Promise<void> {
  const vault = vaultPath();
  if (!vault) return;
  try {
    const { baseRel } = await prepareMirror(vault);
    const idSafe = sanitizeSegment(v.id);
    const dir = path.join(mirrorAbs(vault, baseRel), "Validations");
    const body = `# Validation — ${v.id}

**Type:** \`${v.type}\` · **Last verdict:** \`${v.last_run_verdict}\` · **When:** ${v.last_run_timestamp}

## Target symbols

${v.target_symbols.length ? v.target_symbols.map((s) => `- \`${s}\``).join("\n") : "_none_"}

## Target files

${v.target_files.length ? v.target_files.map((f) => `- \`${f}\``).join("\n") : "_none_"}

## Known failure signatures

${v.known_failure_signatures.length ? v.known_failure_signatures.map((x) => `- \`${x}\``).join("\n") : "_none_"}

${v.provenance && Object.keys(v.provenance).length ? `## Provenance\n\n\`\`\`json\n${JSON.stringify(v.provenance, null, 2)}\n\`\`\`\n` : ""}
${footerMOC(baseRel)}
`;
    await writeNote(dir, idSafe, { tags: ["mimir/validation"], mimir_kind: "validation", mimir_id: v.id }, body);
  } catch (e) {
    console.error("[mimir] Obsidian sync (validation) failed:", e);
  }
}

export async function syncSubsystemToObsidian(card: SubsystemCard): Promise<void> {
  const vault = vaultPath();
  if (!vault) return;
  try {
    const { baseRel } = await prepareMirror(vault);
    const idSafe = sanitizeSegment(card.id);
    const dir = path.join(mirrorAbs(vault, baseRel), "Subsystems");
    const body = `# Subsystem — ${card.id}

${card.description}

## Public API symbols

${card.public_api_symbols.length ? card.public_api_symbols.map((s) => `- \`${s}\``).join("\n") : "_none_"}

## Known invariants

${card.known_invariants.length ? card.known_invariants.map((x) => `- ${x}`).join("\n") : "_none_"}

${footerMOC(baseRel)}
`;
    await writeNote(dir, idSafe, { tags: ["mimir/subsystem"], mimir_kind: "subsystem", mimir_id: card.id }, body);
  } catch (e) {
    console.error("[mimir] Obsidian sync (subsystem) failed:", e);
  }
}

export async function syncTraceToObsidian(t: TraceEntry): Promise<void> {
  const vault = vaultPath();
  if (!vault) return;
  try {
    const { baseRel } = await prepareMirror(vault);
    const idSafe = sanitizeSegment(t.id);
    const dir = path.join(mirrorAbs(vault, baseRel), "Traces");
    const body = `# Trace — ${t.id}

**Verdict:** \`${t.verdict}\` · **When:** ${t.timestamp}

## Target symbols

${t.target_symbols.length ? t.target_symbols.map((s) => `- \`${s}\``).join("\n") : "_none_"}

${footerMOC(baseRel)}
`;
    await writeNote(dir, idSafe, { tags: ["mimir/trace"], mimir_kind: "trace", mimir_id: t.id }, body);
  } catch (e) {
    console.error("[mimir] Obsidian sync (trace) failed:", e);
  }
}
