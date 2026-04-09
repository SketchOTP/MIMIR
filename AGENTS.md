# Mimir MCP — agent playbook

**Keep in sync with:** `.cursor/rules/mimir-mcp.mdc` (Cursor `alwaysApply` rules). Edit **both** when you change workflow text.

**Who loads this:** [OpenAI Codex CLI](https://developers.openai.com/codex/guides/agents-md) reads **`AGENTS.md`** from the project root (and walk-up directories). Cursor reads **`.cursor/rules/mimir-mcp.mdc`**. Same Mimir behavior; two entry points.

Use this document as the **single source of truth** for how to use **Mimir** from any client. Mimir is a **structure-first memory MCP**: YAML **context packets**, **CodeRank** graph (TS/JS/Python), SQLite, episodic **GC**, and tools for ingest → packet → expand → record. **Do not skip Mimir on substantive coding or architecture work** when the server is available.

---

## TL;DR (do this every non-trivial task)

1. **Ingest** the **app repo** with **`mimir_ingest`** using the **absolute path** to its root if you need **`FILE:` / `SYMBOL:`** graph context or freshness is stale (`graph_matches_ingest_head: false`).
2. **Build a packet** with **`mimir_build_packet`** (stable **`task_id`**, clear **`objective`**, **`task_type`**, start **`mode`: `scout`** unless depth needs **`operate` / `investigate` / `forensics`**).
3. **Read the YAML packet** and treat **constraints, invariants, subsystem_cards, lesson_hints, selection_meta, open_questions** as binding inputs.
4. **Expand** every important handle with **`mimir_expand_handle`** — never guess **`RULE:` / `TEST:` / `VERIFIER:` / `SUBSYSTEM:` / `FILE:` / `SYMBOL:`** text.
5. **Record**: **`mimir_record_decision`** / **`mimir_record_validation`** when you change durable rules or tests; **`mimir_record_episode`** when you stop or finish.
6. **Obsidian WIKI** (when enabled): align **slug / name / readme** with the **workspace repo**; after **`mimir_team_ledger_import`** or **`mimir_run_gc`**, run **`mimir_obsidian_backfill`**. Details: **`.cursor/rules/mimir-mcp.mdc`** (Cursor) or this file + WIKI subsection below.

---

## What Mimir does (mental model)

| Concept | Meaning |
|--------|---------|
| **Ingest** | Indexes a repo: graph nodes, CodeRank, FILE/SYMBOL ids. **Not** automatic when Mimir is “installed.” |
| **Context packet** | Token-bounded **YAML** slice: ranked intents, tests, episodes, graph symbols, **subsystem_cards**, **selection_meta**. |
| **Ledger** | SQLite rows: intents, validations, episodes, subsystems, traces — survives across sessions. |
| **Graph** | **FILE:** and **SYMBOL:** handles need **ingest** on that repo’s **absolute root**. |
| **GC** | **`mimir_run_gc`**: turns repeated failed hypotheses into **AUTO_RULE_*** and trims noise. |

---

## Install Mimir vs ingest your project (critical)

| Step | Meaning |
|------|---------|
| **Mimir installed** | Mimir repo on disk, **`npm ci`**, MCP runs **`node <MIMIR>/bin/mimir-mcp.js`**. Does **not** index your app. |
| **Ingest your app** | Call **`mimir_ingest`** with **`path`** = **absolute** directory root of the project under work. |
| **Success check** | Response must show **`structural_graph nodes: N`** with **N > 0** (and **`database:`** path). **N = 0** ⇒ wrong path, no sources, or unreadable tree. |
| **Stale graph** | If **`selection_meta.ingest_freshness.graph_matches_ingest_head`** is **false**, re-run **`mimir_ingest`** on the **same absolute root**. |

Without ingest: **ledger + packets from recorded data** still work; **no reliable `FILE:`/`SYMBOL:`** for that codebase.

---

## Enums (use exact strings in tools)

**`task_type`:** `bug_fix` | `feature_addition` | `refactor` | `architecture_change` | `test_repair` | `config_or_infra` | `performance` | `security` | `research_or_exploration` | `documentation`

**`mode` (budget):** `scout` (start here) | `operate` | `investigate` | `forensics`

**Episode `verdicts`:** `PASS` | `FAIL` | `ERROR` | `PENDING`

**Validation `last_run_verdict` / CI:** `PASS` | `FAIL` | `PENDING`

---

## Complete tool reference

| Tool | Purpose |
|------|---------|
| **`mimir_ingest`** | Build/update graph for **`path`** (absolute repo root). |
| **`mimir_build_packet`** | **Primary context**: **`task_id`**, **`objective`**, **`task_type`**, **`mode`**, **`symbols`**, **`files`**. Optional **`packet_mode`**: `full` (default) or **`delta`** (diff vs last snapshot for this **`task_id`**). Optional **`include_git_path_diff`**: paths changed in git since ingest HEAD. |
| **`mimir_expand_handle`** | Resolve one handle (**`RULE:`** … **`SYMBOL:`**) within budget; same **`mode`** as packet. |
| **`mimir_recall_similar`** | Offline **TF–IDF**-style similarity over intents + episodes; **`query`**, optional **`top_k`**. No embeddings API. |
| **`mimir_record_episode`** | End of task: outcomes, **`failed_hypotheses`**, verdicts, files/commands/tests, risks. |
| **`mimir_record_decision`** | Durable intent: **`id`**, **`type`** (RULE, CONSTRAINT, INVARIANT, DECISION, NON_GOAL), **`description`**, optional **`binding`**: `hard` \| `soft`, **`reference_url`**. |
| **`mimir_record_validation`** | Register/update **`TEST:` / `VERIFIER:`**; optional provenance (**`commit_sha`**, **`ci_run_url`**, **`ci_run_id`**). |
| **`mimir_record_subsystem_card`** | **`SUBSYSTEM:…`** cards; id should start with **`SUBSYSTEM:`**. |
| **`mimir_record_trace`** | Execution trace → boosts **coverage** on graph symbols. |
| **`mimir_query_memory`** | Inspect ledger: filter **`all`** \| intents \| validations \| episodes \| subsystems \| traces. |
| **`mimir_delete_memory`** | Delete one row by kind + id. |
| **`mimir_apply_ci_result`** | Set validation by **`validation_id`** + **`verdict`** + optional CI provenance. |
| **`mimir_team_ledger_export`** | JSON export of intents + validations. |
| **`mimir_team_ledger_import`** | Merge export JSON (**INSERT OR REPLACE**). |
| **`mimir_obsidian_backfill`** | Replay SQLite → **`KGRAPH/<slug>/`**; **`01_PROJECTS/<slug>.md`** = **`mimir_project_name`** + verbatim README + KG section (needs vault config). |
| **`mimir_run_gc`** | Consolidate episodes → rules; trim noise when appropriate. |

---

## Workflow (phases)

### 1. Start

- **`mimir_ingest`** if graph needed or stale.
- **`mimir_build_packet`** with stable **`task_id`**, accurate **`objective`**, correct **`task_type`**, **`mode`** (usually **`scout`** first).
- Optional: **`mimir_recall_similar`** for “what did we decide before?” without a full packet.

### 2. Expand

- For each handle that affects correctness or safety: **`mimir_expand_handle`** with the **same `mode`** as the packet.

### 3. Execute

- Implement consistently with **constraints**, **invariants**, stale symbols, **subsystem_cards**.
- New durable rules → **`mimir_record_decision`** (**`binding: hard`** when it must dominate future packets).
- New/changed tracked tests → **`mimir_record_validation`**.

### 4. Complete

- **`mimir_record_episode`** with honest **`failed_hypotheses`** (use `[]` if none), **`verdicts`**, **`next_best_action`**, etc.
- Repeated wrong hypotheses → consider **`mimir_run_gc`**.

---

## YAML packet — fields to honor

- **`constraints` / `invariants`**: treat as requirements unless explicitly superseded by user.
- **`subsystem_cards`**: domain context; expand **`SUBSYSTEM:`** handles when relevant.
- **`lesson_hints`**: prior distilled lessons.
- **`selection_meta.continuation`**: **`same_task_as_previous`**, **`previous_packet_task_id`** — resume signal.
- **`selection_meta.ingest_freshness`**: if **`graph_matches_ingest_head`** is false → re-ingest.
- **`selection_meta.packet_mode`**: `full` or `delta`.
- **`open_questions`**: possible duplicate or conflicting intents — resolve or acknowledge.

---

## Delta packets and git paths

- First packet for a **`task_id`** is always **full**; server stores a snapshot.
- **`packet_mode`: `delta`**: smaller YAML **diff** vs that snapshot for the same **`task_id`**.
- **`include_git_path_diff`: true**: may list **git-changed paths** since ingest HEAD (needs ingest + git metadata).

---

## CI and team ledger (when relevant)

**CI**

1. Register validations with **`mimir_record_validation`** (stable **`id`**).
2. App repo: **`.mimir/ci-mapping.yaml`** maps CI job names → ids (see **`.mimir/ci-mapping.example.yaml`** in Mimir repo).
3. From automation: **`npm run ci-ingest -- <absolute_repo_root>`** with env **`CI_VERDICT`**, **`MIMIR_VALIDATION_ID`** or **`GITHUB_JOB`**, or call **`mimir_apply_ci_result`**.

**Team ledger**

- **`mimir_team_ledger_export`** / **`mimir_team_ledger_import`** for sharing intents + validations.
- Env: **`MIMIR_TEAM_LEDGER_IMPORT`** (merge at MCP init), **`MIMIR_TEAM_LEDGER_EXPORT_PATH`** (auto-export after decision/validation writes).

---

## Graph coverage (what ingest indexes)

- **TS/JS**: **`ts-morph`** — imports, classes, functions; skips **`node_modules`**, **`dist`**, **`build`**, **`.next`**, **`coverage`**, etc.
- **Python**: top-level **`def` / `async def` / `class`** → **`SYMBOL:relative/path.py::name`** (regex-based, not a full type system).
- **`FILE:`** ids are **absolute** on disk; expansion can match **relative** paths by suffix.
- Use handles **from the packet** after ingest; arbitrary **`SYMBOL:pkg.module::name`** is invalid unless ingested that way.

---

## Database and environment

- **Default DB:** `<MIMIR_repo>/mimir.db` (beside Mimir **`package.json`**), **not** the client cwd.
- **`MIMIR_DB_PATH`**: absolute override. MCP logs **`[mimir-mcp] version: …`**, **`platform: …`**, **`database: …`** on stderr.
- **Obsidian WIKI (optional):** Prefer **`.mimir/config.yaml`** (copy from **`config.example.yaml`**) with **`obsidian.enabled`** and **`vault_path`**, or set **`MIMIR_OBSIDIAN_VAULT_PATH`**. Layout: **`KGRAPH/<slug>/`** (graph) · **`01_PROJECTS/<slug>.md`** (**`mimir_project_name`** + verbatim **README** + KG section). SQLite remains canonical.

| Variable | Role |
|----------|------|
| **`MIMIR_DB_PATH`** | SQLite file path. |
| **`MIMIR_ALLOW_UNSAFE_SECRET_RECORDING`** | `1` = bypass secret scan on writes (avoid). |
| **`MIMIR_TEAM_LEDGER_IMPORT`** | JSON file merged at init. |
| **`MIMIR_TEAM_LEDGER_EXPORT_PATH`** | Auto-rewrite after decision/validation writes. |
| **`MIMIR_CONFIG_PATH`** | Optional absolute path to YAML config. |
| **`MIMIR_OBSIDIAN_VAULT_PATH`** | Vault root; overrides config file path. |
| **`MIMIR_OBSIDIAN_DISABLED`** | `1` = no WIKI mirror. |
| **`MIMIR_OBSIDIAN_PROJECT_SLUG`** | Per-project folder under `KGRAPH/` (default `mimir`). |
| **`MIMIR_OBSIDIAN_PROJECT_NAME`** | **`mimir_project_name`** in project note frontmatter (default: slug). |
| **`MIMIR_OBSIDIAN_README_PATH`** | Absolute path to README to embed in project note. |
| **`MIMIR_OBSIDIAN_MIRROR_REL`** | Override mirror path under vault. |
| **`MIMIR_OBSIDIAN_BASE`** | Legacy flat folder under vault if mirror rel unset. |

Shell syntax differs by OS; for copy-paste env examples run **`npm run install:hints`** in the Mimir repo.

### Obsidian WIKI — team vault (sync with Cursor rule)

- **One vault** for the team (**`obsidian.vault_path`** or **`MIMIR_OBSIDIAN_VAULT_PATH`**). Restart MCP after vault or config changes; stderr shows **`[mimir-mcp] version:`** and **`obsidian wiki:`** when enabled.
- **Layout:** **`01_PROJECTS/<slug>.md`** ( **`mimir_project_name`** + workspace **README** + KG links) · **`KGRAPH/<slug>/`** (**`MOC.md`** + ledger folders). **Slug / name / `readme_path`** should match the **Cursor workspace product**, not necessarily `mimir` when working on another repo.
- **After `mimir_team_ledger_import` or `mimir_run_gc`:** run **`mimir_obsidian_backfill`**. **Update Mimir:** `git pull`, `npm ci`, restart MCP — full WIKI steps: **`.cursor/rules/mimir-mcp.mdc`** in the Mimir repo.

---

## Guardrails

- **No fabricated packet content** — if a tool errors, say so and narrow scope.
- **Stable `task_id`** within one logical task so episodes and deltas correlate.
- **Secrets**: do not paste keys/tokens into Mimir fields; server blocks common patterns unless **`MIMIR_ALLOW_UNSAFE_SECRET_RECORDING=1`**.
- **`N = 0` nodes** after ingest: fix **absolute path**, ensure sources exist, re-ingest.
- **Subsystem id**: use **`SUBSYSTEM:Name`** form for **`mimir_record_subsystem_card`**.
- **Obsidian WIKI:** use **`.mimir/config.yaml`** or env; **`KGRAPH/<slug>/`** for the graph; **`01_PROJECTS/<slug>.md`** lists **`mimir_project_name`** (frontmatter) and **full README** as body, then KG links; **`mimir_obsidian_backfill`** replays SQLite → vault; **`mimir_run_gc`** / bulk **`team_ledger_import`** do not live-sync (use backfill after import).

---

## When to use which tool (quick map)

| Need | Tool |
|------|------|
| Fresh graph / fix stale HEAD | **`mimir_ingest`** |
| Task context / constraints | **`mimir_build_packet`** |
| Smaller follow-up same task | **`mimir_build_packet`** + **`packet_mode`: `delta`** |
| Resolve a handle | **`mimir_expand_handle`** |
| Past decisions without full packet | **`mimir_recall_similar`** |
| Ship a rule or invariant | **`mimir_record_decision`** |
| Register a test/verifier | **`mimir_record_validation`** |
| Close out work | **`mimir_record_episode`** |
| CI result → DB | **`mimir_apply_ci_result`** or **`npm run ci-ingest`** |
| Share/sync ledger JSON | **`mimir_team_ledger_export`** / **`import`** |
| Inspect DB | **`mimir_query_memory`** |
| Cleanup row | **`mimir_delete_memory`** |
| SQLite → Obsidian vault (full replay) | **`mimir_obsidian_backfill`** |
| Consolidate failed tries | **`mimir_run_gc`** |

---

## Codex-specific notes

- **Project instructions:** This file (`AGENTS.md`) is loaded automatically by Codex CLI (see OpenAI docs for **`AGENTS.override.md`**, size limits ~32 KiB default, and merge order).
- **Global defaults:** Put cross-repo habits in **`~/.codex/AGENTS.md`** (optional).
- **Other app repos:** Copy or adapt **`AGENTS.md`** into **that** project root if you use Mimir against a codebase that is not the Mimir repo — the playbook is about **how to call Mimir tools**, not only about developing Mimir itself.
