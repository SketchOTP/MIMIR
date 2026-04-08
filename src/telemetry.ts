import { StorageLayer } from "./storage";
import { TraceEntry } from "./schemas";

export class TelemetryIngestor {
  constructor(private storage: StorageLayer) {}

  async ingestExecutionTrace(trace: TraceEntry) {
    // 1. Save the trace
    await this.storage.saveTrace(trace);

    // 2. Cross-reference with graph and boost runtime coverage weights
    const allNodes = await this.storage.getStructuralNodes();

    for (const node of allNodes) {
      const isExecuted = trace.target_symbols.some(s => node.id.includes(s) || s.includes(node.id));
      if (isExecuted) {
        node.coverage = (node.coverage || 0) + 1;
        if (trace.verdict === "FAIL") {
           // Failed paths are more critical to analyze
           node.coverage += 2; 
        }
        await this.storage.saveStructuralNode(node);
      }
    }
  }
}
