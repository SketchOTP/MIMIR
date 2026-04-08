/**
 * Optional mirror of Mimir ledger rows into an Obsidian vault as Markdown + wikilinks.
 * SQLite remains the source of truth; failures here are logged and never break MCP writes.
 */
import * as fs from "fs/promises";
import * as path from "path";
import yaml from "js-yaml";
import type { EpisodeEntry, IntentDecision, SubsystemCard, TraceEntry, ValidationEntry } from "./schemas";

function vaultPath(): string | null {
  const p = process.env.MIMIR_OBSIDIAN_VAULT_PATH?.trim();
  return p ? path.resolve(p) : null;
}

function baseFolder(): string {
  return (process.env.MIMIR_OBSIDIAN_BASE?.trim() || "Mimir").replace(/[/\\]+/g, path.sep);
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
  base: string,
  taskId: string,
  episodeRelNoExt: string,
  episodeLabel: string
): Promise<void> {
  const safe = sanitizeSegment(taskId);
  const taskDir = path.join(vault, base, "Tasks");
  const taskFile = path.join(taskDir, `${safe}.md`);
  const epLink = wikilink(`${base}/Episodes/${episodeRelNoExt}`, episodeLabel);
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
      }) + `# Task — ${taskId}\n\n## Episodes\n\n- ${epLink}\n\n${footerMOC(base)}`,
      "utf8"
    );
  }
}

function footerMOC(base: string): string {
  return `\n---\n${wikilink(`${base}/MOC`, "← Mimir MOC")}\n`;
}

async function ensureMOC(vault: string, base: string): Promise<void> {
  const mocDir = path.join(vault, base);
  const mocFile = path.join(mocDir, "MOC.md");
  try {
    await fs.access(mocFile);
  } catch {
    await fs.mkdir(mocDir, { recursive: true });
    const body = `# Mimir — MCP memory mirror

Notes in **${base}/** are written by **Mimir MCP** (optional). **SQLite (\`mimir.db\`) is still canonical**; this tree is for Obsidian graph, search, and manual notes.

## How the graph connects

- Each **episode** links to a **task hub** note under \`Tasks/\` (one file per \`task_id\`).
- Episodes link to **validations** they reference (\`tests_run\` → \`Validations/*.md\`).
- **Intents**, **validations**, **subsystems**, and **traces** are one note per row.

Tag: #mimir/moc

---

Enable with env \`MIMIR_OBSIDIAN_VAULT_PATH\` (absolute path to your vault root). Optional: \`MIMIR_OBSIDIAN_BASE\` (subfolder inside the vault, default \`Mimir\`).
`;
    await fs.writeFile(mocFile, fmBlock({ tags: ["mimir/moc"] }) + body, "utf8");
  }
}

export async function syncEpisodeToObsidian(entry: EpisodeEntry): Promise<void> {
  const vault = vaultPath();
  if (!vault) return;
  const base = baseFolder();
  try {
    await ensureMOC(vault, base);
    const safeTask = sanitizeSegment(entry.task_id);
    const tsSlug = entry.timestamp.replace(/[:.]/g, "-");
    const epBase = `${tsSlug}-${safeTask}`;
    const epDir = path.join(vault, base, "Episodes");
    const testsLinks =
      entry.tests_run.length > 0
        ? entry.tests_run.map((t) => `- ${wikilink(`${base}/Validations/${sanitizeSegment(t)}`, t)}`).join("\n")
        : "_none_";

    const body = `# Episode — ${entry.task_id}

**Verdict:** \`${entry.verdicts}\` · **When:** ${entry.timestamp}

**Task hub:** ${wikilink(`${base}/Tasks/${safeTask}`, entry.task_id)}

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
${footerMOC(base)}
`;

    await writeNote(epDir, epBase, { tags: ["mimir/episode"], mimir_kind: "episode", mimir_task_id: entry.task_id, verdict: entry.verdicts }, body);
    await appendToTaskHub(vault, base, entry.task_id, epBase, entry.timestamp);
  } catch (e) {
    console.error("[mimir] Obsidian sync (episode) failed:", e);
  }
}

export async function syncIntentToObsidian(d: IntentDecision): Promise<void> {
  const vault = vaultPath();
  if (!vault) return;
  const base = baseFolder();
  try {
    await ensureMOC(vault, base);
    const idSafe = sanitizeSegment(d.id);
    const dir = path.join(vault, base, "Intents");
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
${footerMOC(base)}
`;
    await writeNote(dir, idSafe, { tags: ["mimir/intent"], mimir_kind: "intent", mimir_id: d.id, mimir_type: d.type }, body);
  } catch (e) {
    console.error("[mimir] Obsidian sync (intent) failed:", e);
  }
}

export async function syncValidationToObsidian(v: ValidationEntry): Promise<void> {
  const vault = vaultPath();
  if (!vault) return;
  const base = baseFolder();
  try {
    await ensureMOC(vault, base);
    const idSafe = sanitizeSegment(v.id);
    const dir = path.join(vault, base, "Validations");
    const body = `# Validation — ${v.id}

**Type:** \`${v.type}\` · **Last verdict:** \`${v.last_run_verdict}\` · **When:** ${v.last_run_timestamp}

## Target symbols

${v.target_symbols.length ? v.target_symbols.map((s) => `- \`${s}\``).join("\n") : "_none_"}

## Target files

${v.target_files.length ? v.target_files.map((f) => `- \`${f}\``).join("\n") : "_none_"}

## Known failure signatures

${v.known_failure_signatures.length ? v.known_failure_signatures.map((x) => `- \`${x}\``).join("\n") : "_none_"}

${v.provenance && Object.keys(v.provenance).length ? `## Provenance\n\n\`\`\`json\n${JSON.stringify(v.provenance, null, 2)}\n\`\`\`\n` : ""}
${footerMOC(base)}
`;
    await writeNote(dir, idSafe, { tags: ["mimir/validation"], mimir_kind: "validation", mimir_id: v.id }, body);
  } catch (e) {
    console.error("[mimir] Obsidian sync (validation) failed:", e);
  }
}

export async function syncSubsystemToObsidian(card: SubsystemCard): Promise<void> {
  const vault = vaultPath();
  if (!vault) return;
  const base = baseFolder();
  try {
    await ensureMOC(vault, base);
    const idSafe = sanitizeSegment(card.id);
    const dir = path.join(vault, base, "Subsystems");
    const body = `# Subsystem — ${card.id}

${card.description}

## Public API symbols

${card.public_api_symbols.length ? card.public_api_symbols.map((s) => `- \`${s}\``).join("\n") : "_none_"}

## Known invariants

${card.known_invariants.length ? card.known_invariants.map((x) => `- ${x}`).join("\n") : "_none_"}

${footerMOC(base)}
`;
    await writeNote(dir, idSafe, { tags: ["mimir/subsystem"], mimir_kind: "subsystem", mimir_id: card.id }, body);
  } catch (e) {
    console.error("[mimir] Obsidian sync (subsystem) failed:", e);
  }
}

export async function syncTraceToObsidian(t: TraceEntry): Promise<void> {
  const vault = vaultPath();
  if (!vault) return;
  const base = baseFolder();
  try {
    await ensureMOC(vault, base);
    const idSafe = sanitizeSegment(t.id);
    const dir = path.join(vault, base, "Traces");
    const body = `# Trace — ${t.id}

**Verdict:** \`${t.verdict}\` · **When:** ${t.timestamp}

## Target symbols

${t.target_symbols.length ? t.target_symbols.map((s) => `- \`${s}\``).join("\n") : "_none_"}

${footerMOC(base)}
`;
    await writeNote(dir, idSafe, { tags: ["mimir/trace"], mimir_kind: "trace", mimir_id: t.id }, body);
  } catch (e) {
    console.error("[mimir] Obsidian sync (trace) failed:", e);
  }
}
