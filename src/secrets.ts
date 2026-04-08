/**
 * Blocks obvious secret material from landing in SQLite via MCP.
 * Set MIMIR_ALLOW_UNSAFE_SECRET_RECORDING=1 to disable (solo power users only).
 */

const PATTERNS: { label: string; re: RegExp }[] = [
  { label: "OpenAI-style API key", re: /\bsk-[a-zA-Z0-9]{20,}\b/ },
  { label: "Anthropic-style key", re: /\bsk-ant-[a-zA-Z0-9-]{10,}\b/ },
  { label: "GitHub PAT (ghp_)", re: /\bghp_[a-zA-Z0-9]{36,}\b/ },
  { label: "GitHub fine-grained token", re: /\bgithub_pat_[a-zA-Z0-9_]{20,}\b/ },
  { label: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "PEM private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

function allowUnsafe(): boolean {
  return process.env.MIMIR_ALLOW_UNSAFE_SECRET_RECORDING === "1";
}

function collectStrings(v: unknown, out: string[]): void {
  if (v == null) return;
  if (typeof v === "string") {
    out.push(v);
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) collectStrings(x, out);
    return;
  }
  if (typeof v === "object") {
    for (const k of Object.keys(v as object)) collectStrings((v as Record<string, unknown>)[k], out);
  }
}

export type SecretScanResult = { ok: true } | { ok: false; reason: string };

export function scanRecordedPayload(label: string, payload: unknown): SecretScanResult {
  if (allowUnsafe()) return { ok: true };
  const strings: string[] = [];
  collectStrings(payload, strings);
  const blob = strings.join("\n");
  for (const { label: L, re } of PATTERNS) {
    if (re.global) re.lastIndex = 0;
    if (re.test(blob)) {
      return {
        ok: false,
        reason: `${label}: possible ${L} in payload. Remove secrets or obfuscate; to bypass set MIMIR_ALLOW_UNSAFE_SECRET_RECORDING=1 (not recommended).`,
      };
    }
  }
  return { ok: true };
}
