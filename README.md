# Mimir V2 — Structure-first, token-bounded memory for AI coding

Mimir keeps **context packets** strictly bounded on large codebases (10k+ files) by combining a **structural graph** (CodeRank centrality, coverage/churn), **YAML** serialization (~30% fewer tokens than JSON), **relevance-ranked** intents/tests/episodes, and **GC** that turns repeated failed hypotheses into durable rules.

## Architecture

| Piece | Role |
|-------|------|
| **Repo cartographer** | Ingests the repo; **CodeRank** (in-degree) highlights core vs. long-tail files. |
| **Telemetry ingestor** | Execution traces boost node **coverage**; runtime-hit (or failing) paths gain weight vs. unused static dependencies. |
| **Lifecycle manager** | **Blast-radius invalidation**: changed files mark dependents `STALE_UPSTREAM_CHANGE`. **Episodic consolidation**: GC promotes repeated `failed_hypotheses` to `IntentLedger` rules and trims episodes. |
| **Context packet builder** | Emits dense **YAML** `ContextPacket`; compares **live `git rev-parse`** at ingest root to last ingest HEAD (`ingest_freshness`); flags near-duplicate intents; **hard**-bound rules sort first; **CodeRank pruning** adds at most **5 / 12 / 24** graph symbols for **scout / operate / investigate & forensics**. |
| **Storage** | SQLite: graph nodes (`centrality`, `coverage`, `churn`, `status`), intent ledger, episodes, `validation_registry`, area lessons. |

**Schemas (high level):** `SubsystemCard` (~100-token domain summaries), `TraceEntry` (telemetry matching), `StructuralNode` (centrality/coverage/churn/status), intents, episodes, validations.

## Proof demo

```bash
npx ts-node src/index.ts
```

Demonstrates: YAML packet compression; CodeRank pruning; **episodic GC** (duplicate hypothesis → `AUTO_RULE_*`, episodes purged); **blast-radius** stale marking (e.g. editing `src/schemas.ts` cascades to dependents).

## Design goals (limits addressed)

- **Scale**: Rank by centrality + coverage; don’t dump all dependents — top symbols per budget.
- **Episodic bloat**: Consolidation collapses many failures into one rule.
- **Token cost**: YAML packets vs. JSON.
- **Static vs. runtime**: Telemetry can overweight paths that actually run or fail.

---

## MCP (Cursor and other clients)

Native MCP server: `node <MIMIR_REPO>/bin/mimir-mcp.js` after `npm install`.

### Install vs. ingest

| | |
|--|--|
| **Install** | Clone repo, `npm install` — does **not** index your app. |
| **Ingest** | Call **`mimir_ingest`** with **absolute path** to each project root. Expect **`structural_graph nodes: N`** (**N > 0**) and **`database:`** in the response. |
| **Without ingest** | Ledger tools work (decisions, episodes, validations, packets from those), but **no `FILE:` / `SYMBOL:` graph** for that repo until ingested. Re-ingest after large refactors or stale graph. |

### Cursor MCP entry

**Settings → MCP → Add server:** type `command`, name `mimir`, command `node`, args `["<ABSOLUTE_PATH_TO_THIS_REPO>/bin/mimir-mcp.js"]`.

### Tools

| Tool | Purpose |
|------|---------|
| `mimir_ingest` | Build/update CodeRank graph for a repo path. |
| `mimir_build_packet` | YAML context packet (task, mode, seeds). |
| `mimir_expand_handle` | Expand `RULE:` / `CONSTRAINT:` / … / `TEST:` / `VERIFIER:` / `ATTEMPT:` / `FILE:` / `SYMBOL:` within token budget. |
| `mimir_record_episode` | Task outcome, verdicts, failed hypotheses. |
| `mimir_record_decision` | Intent ledger (RULE, CONSTRAINT, INVARIANT, DECISION, NON_GOAL). |
| `mimir_record_validation` | `validation_registry` — **`TEST:`** / **`VERIFIER:`** in packets; optional **provenance** (`commit_sha`, `ci_run_url`, `ci_run_id`). |
| `mimir_query_memory` | JSON snapshot of intents / validations / episodes (capped) — solo ledger inspection without a full packet. |
| `mimir_delete_memory` | Delete one intent, validation, or episode by id (cleanup / smoke tests). |
| `mimir_run_gc` | Episodic consolidation (AUTO_RULE synthesis, episode trim). |

**Writes:** MCP blocks obvious **secrets** in recorded text (API keys, PATs, PEM headers, AWS key ids). To override (not recommended): **`MIMIR_ALLOW_UNSAFE_SECRET_RECORDING=1`**.

**Ledger extras:** **`mimir_record_decision`** supports **`binding`**: `hard` (surfaced first in packets) vs `soft`, and optional **`reference_url`** (ADR/issue). **`mimir_record_episode`** supports optional **`commit_sha`**, **`ci_run_url`**, **`ci_run_id`**, **`repo_head_at_close`**.

**Packets:** **`selection_meta.ingest_freshness`** compares stored ingest git HEAD to live repo HEAD — if they differ, re-run **`mimir_ingest`** so `FILE:`/`SYMBOL:` match current commits. **`open_questions`** may list near-duplicate intent descriptions.

### Graph coverage (`mimir_expand_handle`)

- **TS/JS**: `ts-morph` over `**/*.{ts,js}` (imports, classes, interfaces, functions). Paths under **`node_modules`**, **`dist`**, **`build`**, **`.next`**, **`coverage`**, **`vendor`**, **`__generated__`**, minified `.min.js`, etc., are **skipped** so CodeRank targets source.
- **Python**: `**/*.py` (skips `.git`, `node_modules`, `.venv`, `__pycache__`, …): `FILE:` per file; top-level `def` / `async def` / `class` → `SYMBOL:relative/path.py::name` (regex; not a full type system).
- **`FILE:`** ids are **absolute** on disk; expansion also matches **relative** paths by suffix. Re-ingest after upgrading Mimir if you need refreshed Python indexing.

### Database

Single SQLite file:

- **Default:** `<MIMIR_repo>/mimir.db` (next to `package.json`, **not** `cwd`).
- **Override:** `MIMIR_DB_PATH` (absolute) in the MCP process env.

Stderr on start: `[mimir-mcp] database: /path/to/mimir.db`.

### Reset / cleanup

Stop MCP, then delete that `mimir.db`, use **`mimir_delete_memory`**, or delete rows from `intent_ledger`, `episode_journal`, `validation_registry`, `structural_graph` as needed.
