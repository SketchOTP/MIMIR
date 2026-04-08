import {
  EpisodeEntry,
  IntentDecision,
  ValidationEntry,
  StructuralNode,
  SubsystemCard,
  TaskType,
} from "./schemas";
import * as path from "path";

const WORD_RE = /[a-zA-Z_][a-zA-Z0-9_]*/g;

export function tokenize(text: string): Set<string> {
  const s = new Set<string>();
  const lower = text.toLowerCase();
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(lower)) !== null) {
    if (m[0].length >= 2) s.add(m[0]);
  }
  return s;
}

export function wordOverlap(a: string, b: string): number {
  const A = tokenize(a);
  const B = tokenize(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) {
    if (B.has(w)) inter++;
  }
  return inter / Math.sqrt(A.size * B.size);
}

export function normalizeFsPath(p: string): string {
  return path.normalize(p).replace(/\\/g, "/");
}

/** True if paths refer to the same or one contains the other (basename match). */
export function pathsRoughMatch(a: string, b: string): boolean {
  const na = normalizeFsPath(a).toLowerCase();
  const nb = normalizeFsPath(b).toLowerCase();
  if (na === nb) return true;
  if (na.endsWith(nb) || nb.endsWith(na)) return true;
  return path.basename(na) === path.basename(nb) && path.basename(na).length > 2;
}

export function shortSymbolMatch(seed: string, fullId: string): boolean {
  if (!fullId.startsWith("SYMBOL:")) return false;
  const rest = fullId.slice("SYMBOL:".length);
  const qual = rest.includes("::") ? rest.split("::").pop()! : rest;
  if (seed === qual) return true;
  if (qual.endsWith(`.${seed}`) || qual === seed) return true;
  if (seed.includes("::") && rest === seed.replace(/^SYMBOL:/, "")) return true;
  return false;
}

export function scoreIntent(
  intent: IntentDecision,
  objective: string,
  taskType: TaskType,
  seedFiles: string[]
): number {
  let score = wordOverlap(intent.description, objective) * 12;
  const objTokens = [...tokenize(objective)];
  const subsystems = intent.target_scope?.subsystems || [];
  for (const sub of subsystems) {
    const sl = sub.toLowerCase();
    if (objTokens.some((t) => sl.includes(t) || t.includes(sl))) score += 8;
  }
  const scopeFiles = intent.target_scope?.files || [];
  const scopeSyms = intent.target_scope?.symbols || [];
  for (const sf of scopeFiles) {
    const ns = normalizeFsPath(sf);
    if (seedFiles.some((f) => normalizeFsPath(f).includes(ns) || ns.includes(normalizeFsPath(f))))
      score += 10;
  }
  for (const sym of scopeSyms) {
    if (tokenize(objective).has(sym.toLowerCase()) || objective.includes(sym)) score += 6;
  }
  if (taskType === "security" && /secret|auth|permission|token|credential/i.test(intent.description))
    score += 4;
  if (taskType === "performance" && /performance|cache|slow|latency/i.test(intent.description))
    score += 4;
  return score;
}

export function scoreValidation(
  val: ValidationEntry,
  objective: string,
  symbols: string[],
  files: string[]
): number {
  let score = wordOverlap(`${val.id} ${val.known_failure_signatures.join(" ")}`, objective) * 6;
  for (const ts of val.target_symbols) {
    for (const seed of symbols) {
      if (ts === seed || shortSymbolMatch(seed.replace(/^SYMBOL:/, ""), ts) || ts.includes(seed))
        score += 18;
    }
  }
  for (const tf of val.target_files) {
    if (files.some((f) => pathsRoughMatch(f, tf))) score += 14;
  }
  if (val.last_run_verdict === "FAIL") score += 5;
  return score;
}

export function scoreSubsystemCard(
  card: SubsystemCard,
  objective: string,
  symbols: string[],
  files: string[]
): number {
  let score = wordOverlap(card.description, objective) * 10;
  const objTok = tokenize(objective);
  for (const inv of card.known_invariants) {
    if (wordOverlap(inv, objective) > 0.1) score += 8;
  }
  for (const sym of card.public_api_symbols) {
    for (const seed of symbols) {
      const raw = seed.replace(/^SYMBOL:/, "");
      if (sym === seed || shortSymbolMatch(raw, sym) || sym.includes(raw) || raw.includes(sym)) score += 14;
    }
    if (objTok.has(sym.toLowerCase())) score += 6;
  }
  const idShort = card.id.replace(/^SUBSYSTEM:/i, "");
  if (objTok.has(idShort.toLowerCase()) || objective.toLowerCase().includes(idShort.toLowerCase())) score += 10;
  for (const f of files) {
    if (card.description.toLowerCase().includes(path.basename(f).toLowerCase())) score += 4;
  }
  return score;
}

export function scoreEpisode(
  ep: EpisodeEntry,
  objective: string,
  taskId: string,
  seedFiles: string[]
): number {
  if (ep.task_id === taskId) return 1_000;
  let score = 0;
  if (ep.files_touched.some((ft) => seedFiles.some((sf) => pathsRoughMatch(ft, sf)))) score += 28;
  score +=
    wordOverlap(
      `${ep.objective} ${ep.failed_hypotheses.join(" ")} ${ep.outputs_summarized} ${ep.next_best_action}`,
      objective
    ) * 10;
  if (ep.verdicts === "FAIL" || ep.verdicts === "ERROR") score += 12;
  const days = (Date.now() - new Date(ep.timestamp).getTime()) / 86_400_000;
  score += Math.max(0, 8 - days / 45);
  return score;
}

export function buildSeedFileIds(files: string[]): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    try {
      const abs = path.resolve(f);
      out.add(`FILE:${abs}`);
      out.add(`FILE:${normalizeFsPath(abs)}`);
    } catch {
      out.add(`FILE:${normalizeFsPath(f)}`);
    }
  }
  return out;
}

export function nodeRelevantToScope(
  node: StructuralNode,
  seedSymbols: string[],
  seedFiles: string[],
  seedFileIds: Set<string>
): boolean {
  const pathNorm = normalizeFsPath(node.path);
  if (seedFiles.some((f) => pathsRoughMatch(pathNorm, f))) return true;
  for (const s of seedSymbols) {
    if (node.id === s) return true;
    if (node.type === "SYMBOL" && shortSymbolMatch(s.replace(/^SYMBOL:/, ""), node.id)) return true;
  }
  for (const d of node.dependencies) {
    if (seedFileIds.has(d)) return true;
  }
  for (const d of node.dependents) {
    if (seedFileIds.has(d)) return true;
  }
  return false;
}
