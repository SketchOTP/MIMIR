import { ContextPacket, TaskType, BudgetMode, IntentDecision } from "./schemas";
import { StorageLayer } from "./storage";
import { TokenGovernor } from "./token_governor";
import {
  scoreIntent,
  scoreValidation,
  scoreEpisode,
  nodeRelevantToScope,
  buildSeedFileIds,
  normalizeFsPath,
} from "./relevance";
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

export class ContextPacketBuilder {
  constructor(private storage: StorageLayer, private governor: TokenGovernor) {}

  async build(
    taskId: string,
    objective: string,
    taskType: TaskType,
    mode: BudgetMode,
    targetScope: { symbols: string[]; files: string[] }
  ): Promise<string> {
    const budget = this.governor.createBudget(mode);
    const files = targetScope.files.map((f) => normalizeFsPath(f));
    const symbols = targetScope.symbols;
    const seedFileIds = buildSeedFileIds(targetScope.files);

    const ingestRoot = await this.storage.getMetadata("ingest_root");
    const ingestedAt = await this.storage.getMetadata("ingested_at");
    const gitHead = await this.storage.getMetadata("git_head");

    const lessonHints = await this.storage.getLessonsForPaths(files);

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
      selection_meta: {
        ingest:
          ingestRoot != null
            ? {
                root: ingestRoot,
                ingested_at: ingestedAt ?? null,
                git_head: gitHead && gitHead.length > 0 ? gitHead : null,
              }
            : null,
        omitted: {
          intents: 0,
          validations: 0,
          episodes: 0,
          graph_symbols: 0,
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
    const rankedIntents = intents
      .map((i) => ({ i, s: scoreIntent(i, objective, taskType, files) }))
      .sort((a, b) => b.s - a.s);

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
    return yaml.dump(packet, { skipInvalid: true, noRefs: true });
  }
}
