import { StorageLayer } from "./storage";
import { TokenGovernor } from "./token_governor";
import { TokenBudget } from "./schemas";

const INTENT_PREFIX = /^(RULE|CONSTRAINT|INVARIANT|DECISION|NON_GOAL):([\s\S]+)$/;

function stripGraphStatusSuffix(handle: string): string {
  return handle.replace(/\s+\[(VALID|STALE_UPSTREAM_CHANGE)\]$/, "").trim();
}

export class ExpansionResolver {
  constructor(private storage: StorageLayer, private governor: TokenGovernor) {}

  async expandHandle(handle: string, budget: TokenBudget): Promise<string | null> {
    const h = stripGraphStatusSuffix(handle);

    const intentMatch = h.match(INTENT_PREFIX);
    if (intentMatch) {
      const id = intentMatch[2];
      const intents = await this.storage.getIntents();
      const intent = intents.find((i) => i.id === id);
      if (intent) {
        const text = JSON.stringify(intent, null, 2);
        if (this.governor.addCost(budget, text)) return text;
      }
      return null;
    }

    if (h.startsWith("TEST:") || h.startsWith("VERIFIER:")) {
      const id = h.replace(/^(TEST|VERIFIER):/, "");
      const validations = await this.storage.getValidations();
      const val = validations.find((v) => v.id === id);
      if (val) {
        const text = JSON.stringify(val, null, 2);
        if (this.governor.addCost(budget, text)) return text;
      }
      return null;
    }

    if (h.startsWith("ATTEMPT:")) {
      const id = h.split(":")[1].replace("_failed", "");
      const episodes = await this.storage.getEpisodes();
      const ep = episodes.find((e) => e.task_id === id);
      if (ep) {
        const text = JSON.stringify(ep, null, 2);
        if (this.governor.addCost(budget, text)) return text;
      }
      return null;
    }

    if (h.startsWith("FILE:")) {
      let node = await this.storage.getNodeById(h);
      if (!node) node = await this.storage.findFileNodeFlexible(h);
      if (node) {
        const text = JSON.stringify(node, null, 2);
        if (this.governor.addCost(budget, text)) return text;
      }
      return null;
    }

    if (h.startsWith("SYMBOL:")) {
      let node = await this.storage.getNodeById(h);
      if (!node) node = await this.storage.findSymbolNodeFlexible(h);
      if (node) {
        const text = JSON.stringify(node, null, 2);
        if (this.governor.addCost(budget, text)) return text;
      }
      return null;
    }

    if (h.startsWith("SUBSYSTEM:")) {
      const cards = await this.storage.getSubsystemCards();
      const card = cards.find((c) => c.id === h || `SUBSYSTEM:${c.id}` === h);
      if (card) {
        const text = JSON.stringify(card, null, 2);
        if (this.governor.addCost(budget, text)) return text;
      }
      return null;
    }

    return null;
  }
}
