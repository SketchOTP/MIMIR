import { ContextPacket, TaskType, BudgetMode, IntentDecision } from "./schemas";
import { StorageLayer } from "./storage";
import { TokenGovernor } from "./token_governor";
import {
  scoreIntent,
  scoreValidation,
  scoreSubsystemCard,
  scoreEpisode,
  nodeRelevantToScope,
  buildSeedFileIds,
  normalizeFsPath,
} from "./relevance";
import { readLiveGitHead } from "./git_util";
import { gitDiffNameOnlySinceRef } from "./git_diff_paths";
import {
  snapshotFromPacket,
  diffSnapshots,
  snapshotMetadataKey,
  PacketHandleSnapshot,
} from "./packet_snapshot";
import * as yaml from "js-yaml";

function intentHandle(intent: IntentDecision): string {
  switch (intent.type) {
    case "CONSTRAINT":
      return `CONSTRAINT:${intent.id}`;
    case "INVARIANT":
      return `INVARIANT:${intent.id}`;
    case "RULE":
      return `RULE:${intent.id}`;
    case "DECISION":
      return `DECISION:${intent.id}`;
    case "NON_GOAL":
      return `NON_GOAL:${intent.id}`;
    default:
      return `RULE:${intent.id}`;
  }
}

function pushIntentToPacket(packet: ContextPacket, handle: string, intent: IntentDecision): void {
  if (intent.type === "CONSTRAINT" || intent.type === "RULE") {
    packet.constraints.push(handle);
  } else if (intent.type === "INVARIANT") {
    packet.invariants.push(handle);
  } else {
    packet.relevant_decisions.push(handle);
  }
}

/** Near-duplicate intent descriptions (solo cleanup signal). */
function duplicateIntentNotes(intents: IntentDecision[]): string[] {
  const buckets = new Map<string, string[]>();
  for (const i of intents) {
    const key = i.description
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .slice(0, 120);
    if (key.length < 16) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(intentHandle(i));
  }
  const out: string[] = [];
  for (const ids of buckets.values()) {
    if (ids.length >= 2) {
      out.push(`Similar intent descriptions — consider merging: ${ids.join(" vs ")}`);
    }
  }
  return out.slice(0, 6);
}

export type BuildPacketOptions = {
  packetMode?: "full" | "delta";
  /** When packetMode=delta and ingest exists: list paths changed since stored ingest git HEAD. */
  includeGitPathDiff?: boolean;
};

export class ContextPacketBuilder {
  constructor(private storage: StorageLayer, private governor: TokenGovernor) {}

  /** Builds the full in-memory packet (ranking, budgets, graph slice). */
  async buildPacketObject(
    taskId: string,
    objective: string,
    taskType: TaskType,
    mode: BudgetMode,
    targetScope: { symbols: string[]; files: string[] }
  ): Promise<ContextPacket> {
    const budget = this.governor.createBudget(mode);
    const files = targetScope.files.map((f) => normalizeFsPath(f));
    const symbols = targetScope.symbols;
    const seedFileIds = buildSeedFileIds(targetScope.files);

    const ingestRoot = await this.storage.getMetadata("ingest_root");
    const ingestedAt = await this.storage.getMetadata("ingested_at");
    const gitHead = await this.storage.getMetadata("git_head");

    const liveHead = ingestRoot ? readLiveGitHead(ingestRoot) : null;
    const storedHead = gitHead && gitHead.length > 0 ? gitHead : null;
    const graphMatches =
      !storedHead || !liveHead ? true : storedHead === liveHead;
    const ingestFreshness =
      ingestRoot != null
        ? {
            live_git_head: liveHead,
            graph_matches_ingest_head: graphMatches,
            recommendation:
              storedHead && liveHead && storedHead !== liveHead
                ? "Local git HEAD differs from last mimir_ingest; re-run mimir_ingest on the same absolute root to refresh FILE:/SYMBOL: graph."
                : null,
          }
        : null;

    const lessonHints = await this.storage.getLessonsForPaths(files);

    const prevTaskId = (await this.storage.getMetadata("last_context_packet_task_id")) ?? "";

    const packet: ContextPacket = {
      task_id: taskId,
      task_type: taskType,
      objective: objective,
      scope: {
        subsystems: [],
        files: targetScope.files,
        symbols: [...targetScope.symbols],
      },
      constraints: [],
      invariants: [],
      relevant_decisions: [],
      relevant_tests: [],
      relevant_verifiers: [],
      prior_attempts: [],
      known_failures: [],
      known_risks: [],
      evidence: [],
      open_questions: [],
      lesson_hints: lessonHints,
      subsystem_cards: [],
      selection_meta: {
        ingest:
          ingestRoot != null
            ? {
                root: ingestRoot,
                ingested_at: ingestedAt ?? null,
                git_head: gitHead && gitHead.length > 0 ? gitHead : null,
              }
            : null,
        ingest_freshness: ingestFreshness,
        continuation: {
          previous_packet_task_id: prevTaskId.length > 0 ? prevTaskId : null,
          same_task_as_previous: prevTaskId.length > 0 && prevTaskId === taskId,
        },
        omitted: {
          intents: 0,
          validations: 0,
          episodes: 0,
          graph_symbols: 0,
          subsystems: 0,
        },
        ranking: "relevance_v1",
      },
      token_budget: budget,
      provenance_summary: {
        OBSERVED: 0,
        DERIVED: 0,
        STATED: 0,
        HYPOTHESIS: 0,
        VERIFIED: 0,
      },
    };

    const intents = await this.storage.getIntents();
    for (const note of duplicateIntentNotes(intents)) {
      if (packet.open_questions.length < 8) packet.open_questions.push(note);
    }

    const rankedIntents = intents
      .map((i) => ({ i, s: scoreIntent(i, objective, taskType, files) }))
      .sort((a, b) => {
        const pri = (x: { i: IntentDecision }) => (x.i.binding === "hard" ? 0 : 1);
        const d = pri(a) - pri(b);
        if (d !== 0) return d;
        return b.s - a.s;
      });

    let intentAdded = 0;
    for (let idx = 0; idx < rankedIntents.length; idx++) {
      const { i, s } = rankedIntents[idx];
      if (s < 0.02 && idx >= 14) break;
      const handle = intentHandle(i);
      if (this.governor.addCost(budget, handle)) {
        pushIntentToPacket(packet, handle, i);
        intentAdded++;
        packet.provenance_summary.STATED++;
      } else {
        break;
      }
    }
    packet.selection_meta.omitted.intents = Math.max(0, rankedIntents.length - intentAdded);

    const validations = await this.storage.getValidations();
    const rankedVals = validations
      .map((v) => ({ v, s: scoreValidation(v, objective, symbols, files) }))
      .sort((a, b) => b.s - a.s);

    let valAdded = 0;
    for (const { v } of rankedVals) {
      if (rankedVals.length > 0 && rankedVals.every((x) => x.s === 0) && valAdded >= 8) break;
      const valStr = `TEST:${v.id}`;
      const isVerifier = v.type === "VERIFIER" || v.type === "INVARIANT";
      const line = isVerifier ? `VERIFIER:${v.id}` : valStr;
      if (this.governor.addCost(budget, line)) {
        if (isVerifier) packet.relevant_verifiers.push(line);
        else packet.relevant_tests.push(valStr);
        valAdded++;
        packet.provenance_summary.VERIFIED++;
      } else {
        break;
      }
    }
    packet.selection_meta.omitted.validations = Math.max(0, rankedVals.length - valAdded);

    const subCards = await this.storage.getSubsystemCards();
    const rankedSub = subCards
      .map((c) => ({ c, s: scoreSubsystemCard(c, objective, symbols, files) }))
      .sort((a, b) => b.s - a.s);
    const maxSub = mode === "scout" ? 3 : mode === "operate" ? 6 : 12;
    let subAdded = 0;
    for (const { c } of rankedSub) {
      if (subAdded >= maxSub) break;
      const handle = c.id.startsWith("SUBSYSTEM:") ? c.id : `SUBSYSTEM:${c.id}`;
      if (this.governor.addCost(budget, handle)) {
        packet.subsystem_cards.push(handle);
        subAdded++;
        packet.provenance_summary.STATED++;
      } else {
        break;
      }
    }
    packet.selection_meta.omitted.subsystems = Math.max(0, rankedSub.length - subAdded);

    const episodes = await this.storage.getEpisodes();
    const rankedFails = episodes
      .map((e) => ({ e, s: scoreEpisode(e, objective, taskId, files) }))
      .filter((x) => x.e.verdicts === "FAIL" || x.e.verdicts === "ERROR")
      .sort((a, b) => b.s - a.s);

    let epAdded = 0;
    for (const { e } of rankedFails) {
      const attemptStr = `ATTEMPT:${e.task_id}_failed`;
      if (this.governor.addCost(budget, attemptStr)) {
        packet.prior_attempts.push(attemptStr);
        epAdded++;
        packet.provenance_summary.OBSERVED++;
      } else {
        break;
      }
    }
    packet.selection_meta.omitted.episodes = Math.max(0, rankedFails.length - epAdded);

    const allNodes = await this.storage.getStructuralNodes();
    const graphCandidates = allNodes
      .filter((n) => nodeRelevantToScope(n, symbols, files, seedFileIds))
      .sort(
        (a, b) =>
          (b.coverage || 0) * 2 + (b.centrality || 0) - ((a.coverage || 0) * 2 + (a.centrality || 0))
      );

    const maxGraph = mode === "scout" ? 5 : mode === "operate" ? 12 : 24;
    let graphAdded = 0;
    for (const rn of graphCandidates) {
      if (graphAdded >= maxGraph) break;
      const status = rn.status || "VALID";
      const handle = `${rn.id} [${status}]`;
      if (packet.scope.symbols.includes(handle) || packet.scope.symbols.includes(rn.id)) continue;
      if (this.governor.addCost(budget, handle)) {
        packet.scope.symbols.push(handle);
        graphAdded++;
        packet.provenance_summary.DERIVED++;
      } else {
        break;
      }
    }
    packet.selection_meta.omitted.graph_symbols = Math.max(0, graphCandidates.length - graphAdded);

    packet.token_budget = budget;
    return packet;
  }

  async build(
    taskId: string,
    objective: string,
    taskType: TaskType,
    mode: BudgetMode,
    targetScope: { symbols: string[]; files: string[] },
    options?: BuildPacketOptions
  ): Promise<string> {
    const packet = await this.buildPacketObject(taskId, objective, taskType, mode, targetScope);
    packet.selection_meta.packet_mode = "full";

    const snap = snapshotFromPacket(packet);
    const snapKey = snapshotMetadataKey(taskId);
    const ingestRoot = await this.storage.getMetadata("ingest_root");
    const gitHead = await this.storage.getMetadata("git_head");

    await this.storage.setMetadata("last_context_packet_task_id", taskId);

    const modeOpt = options?.packetMode ?? "full";
    if (modeOpt === "delta") {
      const prevRaw = await this.storage.getMetadata(snapKey);
      let prev: PacketHandleSnapshot | null = null;
      if (prevRaw && prevRaw.length > 0) {
        try {
          prev = JSON.parse(prevRaw) as PacketHandleSnapshot;
        } catch {
          prev = null;
        }
      }

      await this.storage.setMetadata(snapKey, JSON.stringify(snap));

      if (!prev) {
        packet.selection_meta.packet_mode = "full";
        return yaml.dump(
          {
            ...packet,
            note: "No prior snapshot for this task_id; saved snapshot. Treat as full packet.",
          },
          { skipInvalid: true, noRefs: true }
        );
      }

      const delta = diffSnapshots(prev, snap);
      let git_path_changes: string[] | undefined;
      if (options?.includeGitPathDiff && ingestRoot && gitHead && gitHead.length > 0) {
        git_path_changes = gitDiffNameOnlySinceRef(ingestRoot, gitHead);
      }

      const deltaDoc: Record<string, unknown> = {
        task_id: taskId,
        task_type: taskType,
        objective,
        packet_mode: "delta",
        delta,
        token_budget: packet.token_budget,
        selection_meta: {
          ...packet.selection_meta,
          packet_mode: "delta",
        },
      };
      if (git_path_changes !== undefined) deltaDoc.git_path_changes = git_path_changes;
      return yaml.dump(deltaDoc, { skipInvalid: true, noRefs: true });
    }

    await this.storage.setMetadata(snapKey, JSON.stringify(snap));
    return yaml.dump(packet, { skipInvalid: true, noRefs: true });
  }
}
