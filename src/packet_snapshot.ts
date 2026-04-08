import * as crypto from "crypto";
import { ContextPacket } from "./schemas";

/** Normalized handle sets for diffing (sorted unique strings). */
export interface PacketHandleSnapshot {
  constraints: string[];
  invariants: string[];
  relevant_decisions: string[];
  relevant_tests: string[];
  relevant_verifiers: string[];
  prior_attempts: string[];
  subsystem_cards: string[];
  scope_symbols: string[];
}

export function snapshotFromPacket(p: ContextPacket): PacketHandleSnapshot {
  return {
    constraints: [...new Set(p.constraints)].sort(),
    invariants: [...new Set(p.invariants)].sort(),
    relevant_decisions: [...new Set(p.relevant_decisions)].sort(),
    relevant_tests: [...new Set(p.relevant_tests)].sort(),
    relevant_verifiers: [...new Set(p.relevant_verifiers)].sort(),
    prior_attempts: [...new Set(p.prior_attempts)].sort(),
    subsystem_cards: [...new Set(p.subsystem_cards)].sort(),
    scope_symbols: [...new Set(p.scope.symbols)].sort(),
  };
}

export function diffField(prev: string[], next: string[]): { added: string[]; removed: string[] } {
  const a = new Set(prev);
  const b = new Set(next);
  return {
    added: next.filter((x) => !a.has(x)),
    removed: prev.filter((x) => !b.has(x)),
  };
}

export function diffSnapshots(
  prev: PacketHandleSnapshot,
  next: PacketHandleSnapshot
): Record<string, { added: string[]; removed: string[] }> {
  return {
    constraints: diffField(prev.constraints, next.constraints),
    invariants: diffField(prev.invariants, next.invariants),
    relevant_decisions: diffField(prev.relevant_decisions, next.relevant_decisions),
    relevant_tests: diffField(prev.relevant_tests, next.relevant_tests),
    relevant_verifiers: diffField(prev.relevant_verifiers, next.relevant_verifiers),
    prior_attempts: diffField(prev.prior_attempts, next.prior_attempts),
    subsystem_cards: diffField(prev.subsystem_cards, next.subsystem_cards),
    scope_symbols: diffField(prev.scope_symbols, next.scope_symbols),
  };
}

export function snapshotMetadataKey(taskId: string): string {
  const h = crypto.createHash("sha256").update(taskId, "utf8").digest("hex").slice(0, 32);
  return `packet_snapshot_${h}`;
}
