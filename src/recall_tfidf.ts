import { StorageLayer } from "./storage";

export type RecallHit = {
  ref: string;
  kind: "intent" | "episode";
  score: number;
  preview: string;
};

function tokenize(text: string): string[] {
  const m = text.toLowerCase().match(/\b[a-z0-9_]{2,}\b/g);
  return m || [];
}

function termFreq(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

function cosineSim(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const v of a.values()) na += v * v;
  for (const v of b.values()) nb += v * v;
  for (const [t, va] of a) {
    const vb = b.get(t);
    if (vb) dot += va * vb;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** TF-IDF–style cosine: query vs document using log-scaled tf and idf from corpus. */
export async function recallSimilar(
  storage: StorageLayer,
  query: string,
  k: number
): Promise<RecallHit[]> {
  const intents = await storage.getIntents();
  const episodes = await storage.getEpisodes();

  const docs: { ref: string; kind: "intent" | "episode"; text: string }[] = [];
  for (const i of intents) {
    docs.push({
      ref: `intent:${i.id}`,
      kind: "intent",
      text: `${i.type} ${i.id} ${i.description}`,
    });
  }
  for (const e of episodes) {
    docs.push({
      ref: `episode:${e.task_id}`,
      kind: "episode",
      text: `${e.objective} ${e.failed_hypotheses.join(" ")} ${e.outputs_summarized} ${e.next_best_action}`,
    });
  }

  if (docs.length === 0) return [];

  const docTokens = docs.map((d) => tokenize(d.text));
  const df = new Map<string, number>();
  for (const tokens of docTokens) {
    const seen = new Set(tokens);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = docs.length;
  const idf = (t: string) => Math.log(1 + N / (1 + (df.get(t) || 0)));

  const qTokens = tokenize(query);
  const qTf = termFreq(qTokens);
  const qVec = new Map<string, number>();
  for (const [t, c] of qTf) qVec.set(t, c * idf(t));

  const scored: RecallHit[] = [];
  for (let i = 0; i < docs.length; i++) {
    const tf = termFreq(docTokens[i]);
    const dVec = new Map<string, number>();
    for (const [t, c] of tf) dVec.set(t, c * idf(t));
    const score = cosineSim(qVec, dVec);
    const preview = docs[i].text.slice(0, 240);
    scored.push({ ref: docs[i].ref, kind: docs[i].kind, score, preview });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((x) => x.score > 0).slice(0, Math.max(1, k));
}
