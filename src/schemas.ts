export enum ProvenanceTier {
  OBSERVED = "OBSERVED",
  DERIVED = "DERIVED",
  STATED = "STATED",
  HYPOTHESIS = "HYPOTHESIS",
  VERIFIED = "VERIFIED"
}

export interface Provenance {
  tier: ProvenanceTier;
  source: string;
  timestamp: string;
}

export type TaskType = "bug_fix" | "feature_addition" | "refactor" | "architecture_change" | "test_repair" | "config_or_infra" | "performance" | "security" | "research_or_exploration" | "documentation";

export type BudgetMode = "scout" | "operate" | "investigate" | "forensics";

export interface TokenBudget {
  mode: BudgetMode;
  max_input_tokens: number;
  used_tokens: number;
}

export interface IngestFreshness {
  /** HEAD read live from ingest_root on the machine running MCP (may differ from stored after local commits). */
  live_git_head: string | null;
  /** True when live and stored heads match (or neither set). */
  graph_matches_ingest_head: boolean;
  /** Non-null when re-ingest is recommended. */
  recommendation: string | null;
}

/** Solo continuity: whether this packet is a follow-up in the same task_id session. */
export interface PacketContinuation {
  previous_packet_task_id: string | null;
  same_task_as_previous: boolean;
}

export interface ContextSelectionMeta {
  ingest: {
    root: string;
    ingested_at: string | null;
    git_head: string | null;
  } | null;
  /** Compares stored ingest git_head to live `git rev-parse` at ingest root (solo dev stale-graph signal). */
  ingest_freshness: IngestFreshness | null;
  /** Updated after each successful packet build (for resume / multi-call awareness). */
  continuation: PacketContinuation | null;
  omitted: {
    intents: number;
    validations: number;
    episodes: number;
    graph_symbols: number;
    subsystems: number;
  };
  ranking: "relevance_v1";
  /** full = complete packet; delta = handle-level diff vs last snapshot for this task_id. */
  packet_mode?: "full" | "delta";
}

export interface ContextPacket {
  task_id: string;
  task_type: TaskType;
  objective: string;
  scope: {
    subsystems: string[];
    files: string[];
    symbols: string[];
  };
  constraints: string[];
  invariants: string[];
  relevant_decisions: string[];
  relevant_tests: string[];
  relevant_verifiers: string[];
  prior_attempts: string[];
  known_failures: string[];
  known_risks: string[];
  evidence: string[];
  open_questions: string[];
  lesson_hints: string[];
  /** Ranked subsystem card handles (see mimir_record_subsystem_card). */
  subsystem_cards: string[];
  selection_meta: ContextSelectionMeta;
  token_budget: TokenBudget;
  provenance_summary: Record<ProvenanceTier, number>;
}

/** Optional CI / repo pins for solo audit trail (episodes & validations). */
export interface RecordProvenance {
  commit_sha?: string;
  ci_run_url?: string;
  ci_run_id?: string;
  /** Repo HEAD when episode closed (e.g. output of git rev-parse). */
  repo_head_at_close?: string;
}

export interface EpisodeEntry {
  task_id: string;
  timestamp: string;
  objective: string;
  assumptions: string[];
  files_touched: string[];
  commands_run: string[];
  outputs_summarized: string;
  tests_run: string[];
  verdicts: "PASS" | "FAIL" | "ERROR" | "PENDING";
  failed_hypotheses: string[];
  accepted_solution?: string;
  residual_risks: string[];
  next_best_action: string;
  provenance?: RecordProvenance;
}

export interface ValidationEntry {
  id: string;
  type: "TEST" | "VERIFIER" | "INVARIANT";
  target_symbols: string[];
  target_files: string[];
  known_failure_signatures: string[];
  last_run_verdict: "PASS" | "FAIL" | "PENDING";
  last_run_timestamp: string;
  provenance?: RecordProvenance;
}

export type IntentBinding = "hard" | "soft";

export interface IntentDecision {
  id: string;
  description: string;
  type: "RULE" | "CONSTRAINT" | "INVARIANT" | "DECISION" | "NON_GOAL";
  target_scope: {
    subsystems?: string[];
    files?: string[];
    symbols?: string[];
  };
  /** hard = prioritize in packets (constitutional); soft = default. */
  binding?: IntentBinding;
  /** Optional ADR / issue / doc URL. */
  reference_url?: string;
}

export interface StructuralNode {
  id: string;
  type: "FILE" | "SYMBOL" | "SUBSYSTEM";
  path: string;
  dependencies: string[];
  dependents: string[];
  hash: string;
  bodyPreview?: string;
  centrality?: number;
  coverage?: number;
  churn?: number;
  status?: "VALID" | "STALE_UPSTREAM_CHANGE";
}

export interface TraceEntry {
  id: string;
  timestamp: string;
  target_symbols: string[];
  verdict: "PASS" | "FAIL";
}

export interface SubsystemCard {
  id: string; // e.g., SUBSYSTEM:Auth
  description: string;
  public_api_symbols: string[];
  known_invariants: string[];
}
