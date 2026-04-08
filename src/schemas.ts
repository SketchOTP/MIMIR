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

export interface ContextSelectionMeta {
  ingest: {
    root: string;
    ingested_at: string | null;
    git_head: string | null;
  } | null;
  omitted: {
    intents: number;
    validations: number;
    episodes: number;
    graph_symbols: number;
  };
  ranking: "relevance_v1";
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
  selection_meta: ContextSelectionMeta;
  token_budget: TokenBudget;
  provenance_summary: Record<ProvenanceTier, number>;
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
}

export interface ValidationEntry {
  id: string;
  type: "TEST" | "VERIFIER" | "INVARIANT";
  target_symbols: string[];
  target_files: string[];
  known_failure_signatures: string[];
  last_run_verdict: "PASS" | "FAIL" | "PENDING";
  last_run_timestamp: string;
}

export interface IntentDecision {
  id: string;
  description: string;
  type: "RULE" | "CONSTRAINT" | "INVARIANT" | "DECISION" | "NON_GOAL";
  target_scope: {
    subsystems?: string[];
    files?: string[];
    symbols?: string[];
  };
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
