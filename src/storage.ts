import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import * as path from "path";
import { EpisodeEntry, IntentDecision, ValidationEntry, StructuralNode, TraceEntry } from "./schemas";

export class StorageLayer {
  private db!: Database;
  private dataFilePath = "";

  getDataFilePath(): string {
    return this.dataFilePath;
  }

  async init(filename: string = "memory.db") {
    this.dataFilePath = path.resolve(filename);
    this.db = await open({
      filename: this.dataFilePath,
      driver: sqlite3.Database
    });

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS intent_ledger (
        id TEXT PRIMARY KEY,
        type TEXT,
        description TEXT,
        target_scope TEXT
      );
      CREATE TABLE IF NOT EXISTS episode_journal (
        task_id TEXT PRIMARY KEY,
        timestamp TEXT,
        objective TEXT,
        assumptions TEXT,
        files_touched TEXT,
        commands_run TEXT,
        outputs_summarized TEXT,
        tests_run TEXT,
        verdicts TEXT,
        failed_hypotheses TEXT,
        accepted_solution TEXT,
        residual_risks TEXT,
        next_best_action TEXT
      );
      CREATE TABLE IF NOT EXISTS validation_registry (
        id TEXT PRIMARY KEY,
        type TEXT,
        target_symbols TEXT,
        target_files TEXT,
        known_failure_signatures TEXT,
        last_run_verdict TEXT,
        last_run_timestamp TEXT
      );
      CREATE TABLE IF NOT EXISTS structural_graph (
        id TEXT PRIMARY KEY,
        type TEXT,
        path TEXT,
        dependencies TEXT,
        dependents TEXT,
        hash TEXT,
        bodyPreview TEXT,
        centrality REAL DEFAULT 0,
        coverage REAL DEFAULT 0,
        churn REAL DEFAULT 0,
        status TEXT DEFAULT 'VALID'
      );
      CREATE TABLE IF NOT EXISTS subsystem_cards (
        id TEXT PRIMARY KEY,
        description TEXT,
        public_api_symbols TEXT,
        known_invariants TEXT
      );
      CREATE TABLE IF NOT EXISTS telemetry_traces (
        id TEXT PRIMARY KEY,
        timestamp TEXT,
        target_symbols TEXT,
        verdict TEXT
      );
      CREATE TABLE IF NOT EXISTS mimir_metadata (
        k TEXT PRIMARY KEY,
        v TEXT
      );
      CREATE TABLE IF NOT EXISTS area_lessons (
        scope_key TEXT PRIMARY KEY,
        summary TEXT,
        updated_at TEXT
      );
    `);
    await this.migrateSchema();
  }

  /** Add columns for existing mimir.db files created before these fields existed. */
  private async migrateSchema(): Promise<void> {
    await this.ensureColumn("intent_ledger", "binding", "ALTER TABLE intent_ledger ADD COLUMN binding TEXT DEFAULT 'soft'");
    await this.ensureColumn("intent_ledger", "reference_url", "ALTER TABLE intent_ledger ADD COLUMN reference_url TEXT");
    await this.ensureColumn("episode_journal", "provenance_json", "ALTER TABLE episode_journal ADD COLUMN provenance_json TEXT");
    await this.ensureColumn("validation_registry", "provenance_json", "ALTER TABLE validation_registry ADD COLUMN provenance_json TEXT");
  }

  private async ensureColumn(table: string, column: string, ddl: string): Promise<void> {
    const rows = await this.db.all(`PRAGMA table_info(${table})`);
    const names = new Set(rows.map((r: { name: string }) => r.name));
    if (!names.has(column)) await this.db.exec(ddl);
  }

  async setMetadata(key: string, value: string): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO mimir_metadata (k, v) VALUES (?, ?)`,
      key,
      value
    );
  }

  async getMetadata(key: string): Promise<string | undefined> {
    const row = await this.db.get(`SELECT v FROM mimir_metadata WHERE k = ?`, key);
    return row?.v as string | undefined;
  }

  /** Append a line to a scope lesson (deduplicated lines). */
  async upsertLessonLine(scopeKey: string, line: string): Promise<void> {
    const row = await this.db.get(`SELECT summary, updated_at FROM area_lessons WHERE scope_key = ?`, scopeKey);
    const now = new Date().toISOString();
    const trimmed = line.trim();
    if (!trimmed) return;
    if (!row) {
      await this.db.run(
        `INSERT INTO area_lessons (scope_key, summary, updated_at) VALUES (?, ?, ?)`,
        scopeKey,
        trimmed,
        now
      );
      return;
    }
    const existing = (row.summary as string) || "";
    const lines = new Set(
      existing
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    );
    if (lines.has(trimmed)) return;
    lines.add(trimmed);
    const merged = [...lines].join("\n");
    await this.db.run(`UPDATE area_lessons SET summary = ?, updated_at = ? WHERE scope_key = ?`, merged, now, scopeKey);
  }

  async getLessonsForPaths(normalizedPaths: string[]): Promise<string[]> {
    if (normalizedPaths.length === 0) return [];
    const rows = await this.db.all(`SELECT scope_key, summary FROM area_lessons`);
    const hints: string[] = [];
    for (const r of rows) {
      const key = r.scope_key as string;
      const summary = r.summary as string;
      if (key === "global") {
        hints.push(`[global] ${summary}`);
        continue;
      }
      const keyNorm = key.replace(/\\/g, "/");
      for (const p of normalizedPaths) {
        if (p.includes(keyNorm) || p.startsWith(keyNorm) || keyNorm.startsWith(p)) {
          hints.push(`[${key}] ${summary}`);
          break;
        }
      }
    }
    return hints;
  }

  async saveIntent(intent: IntentDecision) {
    const binding = intent.binding ?? "soft";
    const ref = intent.reference_url ?? null;
    await this.db.run(
      `INSERT OR REPLACE INTO intent_ledger (id, type, description, target_scope, binding, reference_url) VALUES (?, ?, ?, ?, ?, ?)`,
      intent.id,
      intent.type,
      intent.description,
      JSON.stringify(intent.target_scope),
      binding,
      ref
    );
  }

  async getIntents(): Promise<IntentDecision[]> {
    const rows = await this.db.all(`SELECT * FROM intent_ledger`);
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: row.id as string,
        type: row.type as IntentDecision["type"],
        description: row.description as string,
        target_scope: JSON.parse(row.target_scope as string),
        binding: (row.binding as IntentDecision["binding"]) || "soft",
        reference_url: (row.reference_url as string) || undefined,
      };
    });
  }

  async deleteIntent(id: string): Promise<void> {
    await this.db.run(`DELETE FROM intent_ledger WHERE id = ?`, id);
  }

  async saveEpisode(episode: EpisodeEntry) {
    const prov =
      episode.provenance && Object.keys(episode.provenance).length > 0
        ? JSON.stringify(episode.provenance)
        : null;
    await this.db.run(
      `INSERT OR REPLACE INTO episode_journal (task_id, timestamp, objective, assumptions, files_touched, commands_run, outputs_summarized, tests_run, verdicts, failed_hypotheses, accepted_solution, residual_risks, next_best_action, provenance_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      episode.task_id,
      episode.timestamp,
      episode.objective,
      JSON.stringify(episode.assumptions),
      JSON.stringify(episode.files_touched),
      JSON.stringify(episode.commands_run),
      episode.outputs_summarized,
      JSON.stringify(episode.tests_run),
      episode.verdicts,
      JSON.stringify(episode.failed_hypotheses),
      episode.accepted_solution || "",
      JSON.stringify(episode.residual_risks),
      episode.next_best_action,
      prov
    );
  }

  async deleteEpisode(taskId: string) {
    await this.db.run(`DELETE FROM episode_journal WHERE task_id = ?`, taskId);
  }

  async getEpisodes(): Promise<EpisodeEntry[]> {
    const rows = await this.db.all(`SELECT * FROM episode_journal`);
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      let provenance: EpisodeEntry["provenance"];
      const pj = row.provenance_json as string | null | undefined;
      if (pj && pj.length > 0) {
        try {
          provenance = JSON.parse(pj);
        } catch {
          provenance = undefined;
        }
      }
      return {
        task_id: row.task_id as string,
        timestamp: row.timestamp as string,
        objective: row.objective as string,
        assumptions: JSON.parse(row.assumptions as string),
        files_touched: JSON.parse(row.files_touched as string),
        commands_run: JSON.parse(row.commands_run as string),
        outputs_summarized: row.outputs_summarized as string,
        tests_run: JSON.parse(row.tests_run as string),
        verdicts: row.verdicts as EpisodeEntry["verdicts"],
        failed_hypotheses: JSON.parse(row.failed_hypotheses as string),
        accepted_solution: (row.accepted_solution as string) || undefined,
        residual_risks: JSON.parse(row.residual_risks as string),
        next_best_action: row.next_best_action as string,
        provenance,
      };
    });
  }

  async saveValidation(validation: ValidationEntry) {
    const prov =
      validation.provenance && Object.keys(validation.provenance).length > 0
        ? JSON.stringify(validation.provenance)
        : null;
    await this.db.run(
      `INSERT OR REPLACE INTO validation_registry (id, type, target_symbols, target_files, known_failure_signatures, last_run_verdict, last_run_timestamp, provenance_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      validation.id,
      validation.type,
      JSON.stringify(validation.target_symbols),
      JSON.stringify(validation.target_files),
      JSON.stringify(validation.known_failure_signatures),
      validation.last_run_verdict,
      validation.last_run_timestamp,
      prov
    );
  }

  async getValidations(): Promise<ValidationEntry[]> {
    const rows = await this.db.all(`SELECT * FROM validation_registry`);
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      let provenance: ValidationEntry["provenance"];
      const pj = row.provenance_json as string | null | undefined;
      if (pj && pj.length > 0) {
        try {
          provenance = JSON.parse(pj);
        } catch {
          provenance = undefined;
        }
      }
      return {
        id: row.id as string,
        type: row.type as ValidationEntry["type"],
        target_symbols: JSON.parse(row.target_symbols as string),
        target_files: JSON.parse(row.target_files as string),
        known_failure_signatures: JSON.parse(row.known_failure_signatures as string),
        last_run_verdict: row.last_run_verdict as ValidationEntry["last_run_verdict"],
        last_run_timestamp: row.last_run_timestamp as string,
        provenance,
      };
    });
  }

  async deleteValidation(id: string): Promise<void> {
    await this.db.run(`DELETE FROM validation_registry WHERE id = ?`, id);
  }

  async saveStructuralNode(node: StructuralNode) {
    await this.db.run(
      `INSERT OR REPLACE INTO structural_graph (id, type, path, dependencies, dependents, hash, bodyPreview, centrality, coverage, churn, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      node.id, node.type, node.path, JSON.stringify(node.dependencies), JSON.stringify(node.dependents), node.hash, node.bodyPreview || "", node.centrality || 0, node.coverage || 0, node.churn || 0, node.status || 'VALID'
    );
  }

  async updateNodeStatus(id: string, status: string) {
    await this.db.run(`UPDATE structural_graph SET status = ? WHERE id = ?`, status, id);
  }

  async saveTrace(trace: TraceEntry) {
    await this.db.run(
      `INSERT OR REPLACE INTO telemetry_traces (id, timestamp, target_symbols, verdict) VALUES (?, ?, ?, ?)`,
      trace.id, trace.timestamp, JSON.stringify(trace.target_symbols), trace.verdict
    );
  }

  async getTraces(): Promise<TraceEntry[]> {
    const rows = await this.db.all(`SELECT * FROM telemetry_traces`);
    return rows.map(r => ({
      ...r,
      target_symbols: JSON.parse(r.target_symbols)
    }));
  }

  async countStructuralNodes(): Promise<number> {
    const row = await this.db.get(`SELECT COUNT(*) as c FROM structural_graph`);
    return Number((row as { c: number })?.c ?? 0);
  }

  async getStructuralNodes(): Promise<StructuralNode[]> {
    const rows = await this.db.all(`SELECT * FROM structural_graph`);
    return rows.map(r => ({
      ...r,
      dependencies: JSON.parse(r.dependencies),
      dependents: JSON.parse(r.dependents)
    }));
  }

  async getNodeById(id: string): Promise<StructuralNode | undefined> {
    const r = await this.db.get(`SELECT * FROM structural_graph WHERE id = ?`, id);
    if (!r) return undefined;
    return {
      ...r,
      dependencies: JSON.parse(r.dependencies),
      dependents: JSON.parse(r.dependents)
    };
  }

  async removeNodesByPath(path: string) {
    await this.db.run(`DELETE FROM structural_graph WHERE path = ?`, path);
  }

  /** Resolve FILE node when id is not exact (relative path, mixed separators). */
  async findFileNodeFlexible(fileHandlePayload: string): Promise<StructuralNode | undefined> {
    const raw = fileHandlePayload.startsWith("FILE:") ? fileHandlePayload.slice("FILE:".length) : fileHandlePayload;
    const direct = await this.getNodeById(`FILE:${raw}`);
    if (direct) return direct;
    const normalizedAsk = raw.replace(/\\/g, "/");
    const nodes = await this.getStructuralNodes();
    const fileNodes = nodes.filter((n) => n.type === "FILE");
    return fileNodes.find((n) => {
      const p = n.path.replace(/\\/g, "/");
      return p === normalizedAsk || p.endsWith("/" + normalizedAsk) || p.endsWith(normalizedAsk);
    });
  }

  /** Resolve SYMBOL node when id is not exact (path normalization). */
  async findSymbolNodeFlexible(symbolHandlePayload: string): Promise<StructuralNode | undefined> {
    const raw = symbolHandlePayload.startsWith("SYMBOL:") ? symbolHandlePayload.slice("SYMBOL:".length) : symbolHandlePayload;
    const fullId = symbolHandlePayload.startsWith("SYMBOL:") ? symbolHandlePayload : `SYMBOL:${symbolHandlePayload}`;
    const direct = await this.getNodeById(fullId);
    if (direct) return direct;
    const idx = raw.lastIndexOf("::");
    if (idx === -1) return undefined;
    const rel = raw.slice(0, idx).replace(/\\/g, "/");
    const name = raw.slice(idx + 2);
    const nodes = await this.getStructuralNodes();
    const symNodes = nodes.filter((n) => n.type === "SYMBOL");
    const exactRel = symNodes.find((n) => n.id === `SYMBOL:${rel}::${name}`);
    if (exactRel) return exactRel;
    return symNodes.find((n) => {
      if (!n.id.endsWith(`::${name}`)) return false;
      const pathNorm = n.path.replace(/\\/g, "/");
      return pathNorm.endsWith(rel) || pathNorm.endsWith("/" + rel);
    });
  }
}
