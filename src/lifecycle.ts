import * as crypto from "crypto";
import * as path from "path";
import { StorageLayer } from "./storage";

export class LifecycleManager {
  constructor(private storage: StorageLayer) {}

  async invalidateStaleMemory(changedPaths: string[]) {
    const normalized = changedPaths.map((p) => path.normalize(p));

    for (const p of normalized) {
      await this.storage.removeNodesByPath(p);
    }

    const allNodes = await this.storage.getStructuralNodes();
    for (const node of allNodes) {
      const dependsOnStale = node.dependencies.some((dep) => {
        if (dep.startsWith("FILE:")) {
          const fp = dep.slice("FILE:".length);
          const nfp = path.normalize(fp);
          return normalized.some((p) => path.normalize(p) === nfp);
        }
        return normalized.some((p) => dep.includes(p) || p.includes(dep));
      });

      if (dependsOnStale) {
        await this.storage.updateNodeStatus(node.id, "STALE_UPSTREAM_CHANGE");
      }
    }
  }

  async runEpisodicConsolidation() {
    const episodes = await this.storage.getEpisodes();
    const failuresCount: Record<string, number> = {};

    episodes.forEach((ep) => {
      ep.failed_hypotheses.forEach((hyp) => {
        failuresCount[hyp] = (failuresCount[hyp] || 0) + 1;
      });
    });

    for (const [hyp, count] of Object.entries(failuresCount)) {
      if (count >= 2) {
        const suffix = crypto.createHash("sha256").update(hyp).digest("hex").slice(0, 10);
        const ruleId = `AUTO_RULE_${suffix}`;
        await this.storage.saveIntent({
          id: ruleId,
          type: "RULE",
          description: `Consolidated from ${count} failures: Avoid '${hyp}'`,
          target_scope: {},
          binding: "soft",
        });

        await this.storage.upsertLessonLine(
          "global",
          `Repeated dead end (${count}×): ${hyp}`
        );

        for (const ep of episodes) {
          if (ep.failed_hypotheses.includes(hyp)) {
            await this.storage.deleteEpisode(ep.task_id);
          }
        }
      }
    }
  }
}

