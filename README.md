# Mimir — Structure-first, token-bounded memory for AI coding

**Repository:** [github.com/SketchOTP/MIMIR](https://github.com/SketchOTP/MIMIR) · **License:** [ISC](https://opensource.org/licenses/ISC) (see `package.json`)

**Current release: 4.x** — YAML context packets, CodeRank-backed graph slices, episodic GC, and MCP tools for ingest, expansion, recording, **delta packets**, **offline similarity recall**, **CI validation hooks**, and **team ledger** import/export.

Mimir keeps **context packets** bounded on large codebases (10k+ files) by combining a **structural graph** (CodeRank centrality, coverage/churn), **YAML** serialization (~30% fewer tokens than JSON), **relevance-ranked** intents/tests/episodes, and **GC** that turns repeated failed hypotheses into durable rules.

**AI agents:** **Cursor** applies **`.cursor/rules/mimir-mcp.mdc`**. **OpenAI Codex** loads **`AGENTS.md`** from the repo root ([Codex `AGENTS.md` guide](https://developers.openai.com/codex/guides/agents-md)). The playbook is the same—**edit both files together** when you change workflow text. Optional global Codex defaults: `~/.codex/AGENTS.md`.

## Contents

- [Architecture](#architecture)
- [Agent instructions (Cursor + Codex)](#agent-instructions-cursor--codex)
- [Clone, pull, and install](#clone-pull-and-install)
- [Proof demo](#proof-demo), [smoke tests](#smoke-tests), [npm scripts](#npm-scripts)
- [Design goals](#design-goals-limits-addressed)
- [MCP (Cursor and clients)](#mcp-cursor-and-other-clients)
- [License](#license)

## Architecture

| Piece | Role |
|-------|------|
| **Repo cartographer** | Ingests the repo; **CodeRank** (in-degree) highlights core vs. long-tail files. |
| **Telemetry ingestor** | Execution traces boost node **coverage**; runtime-hit (or failing) paths gain weight vs. unused static dependencies. |
| **Lifecycle manager** | **Blast-radius invalidation**: changed files mark dependents `STALE_UPSTREAM_CHANGE`. **Episodic consolidation**: GC promotes repeated `failed_hypotheses` to `IntentLedger` rules and trims episodes. |
| **Context packet builder** | Emits dense **YAML** `ContextPacket`; **subsystem_cards** + ranked intents/tests; **continuation** (same `task_id` as last packet); compares **live `git rev-parse`** to ingest HEAD (`ingest_freshness`); near-duplicate intents; **hard**-bound rules first; **CodeRank** caps graph symbols (**5 / 12 / 24** by mode). **v4:** optional **delta** mode (YAML diff vs. last packet for this `task_id`) and optional **git path list** since ingest HEAD. |
| **Recall (v4)** | **TF–IDF–style** cosine similarity over intent text and episodes — **offline**, no embedding API. |
| **Team ledger (v4)** | Export/import JSON for intents + validations; optional env-driven merge at startup and auto-export after writes. |
| **CI hook (v4)** | Map CI job names to `validation_registry` ids via **`.mimir/ci-mapping.yaml`**; script or MCP updates verdicts from CI. |
| **Storage** | SQLite: graph nodes (`centrality`, `coverage`, `churn`, `status`), intent ledger, episodes, `validation_registry`, area lessons, per-task packet snapshots (for delta). |

**Schemas (high level):** `SubsystemCard` (~100-token domain summaries), `TraceEntry` (telemetry matching), `StructuralNode` (centrality/coverage/churn/status), intents, episodes, validations.

## Agent instructions (Cursor + Codex)

| Client | Where rules live |
|--------|------------------|
| **Cursor** | `.cursor/rules/mimir-mcp.mdc` (this repo; `alwaysApply: true`) |
| **OpenAI Codex CLI** | `AGENTS.md` at repository root (auto-loaded; merged with `~/.codex/AGENTS.md` if present) |

Working on **another codebase** with Codex but using Mimir MCP: add an **`AGENTS.md`** (or the same Mimir playbook) to **that** project’s root so Codex receives the ingest → packet → expand → record workflow.

## Clone, pull, and install

**Prerequisites:** [Node.js](https://nodejs.org/) **18 or newer** (LTS recommended). This repo sets `"engines": { "node": ">=18.0.0" }` in `package.json`.

**Everything you need** to run Mimir is declared in **`package.json`** and pinned by the committed **`package-lock.json`**. After a **clone** or **`git pull`**, install dependencies from the repo root:

```bash
npm ci
```

**`npm ci`** installs the exact tree from `package-lock.json` (recommended for pulls, CI, and reproducible setups). Use **`npm install`** when you are intentionally adding or upgrading packages and will commit an updated lockfile.

**Fresh clone:**

```bash
git clone https://github.com/SketchOTP/MIMIR.git
cd MIMIR
npm ci
```

**Update an existing clone:**

```bash
git pull
npm ci
```

If `npm ci` fails because `node_modules` is in a bad state, remove it and retry, then `npm ci` again:

- **Any OS (recommended):** `npm run clean` — removes `node_modules` using Node’s filesystem API (works on Windows and Linux/macOS).
- **Linux / macOS:** `rm -rf node_modules`
- **Windows cmd:** `rmdir /s /q node_modules`
- **Windows PowerShell:** `Remove-Item -Recurse -Force node_modules`

**OS-specific commands** (env vars, CI ingest examples): run **`npm run install:hints`** — it detects the OS and prints the right syntax for Windows vs Linux/macOS.

**`sqlite3` (native):** Prebuilt binaries are used when available. If the install step tries to compile from source and fails, install OS build tools for [node-gyp](https://github.com/nodejs/node-gyp#installation):

| OS | Typical requirement |
|----|---------------------|
| **Windows** | Visual Studio Build Tools with “Desktop development with C++”, or full VS with that workload; Python 3 in PATH for node-gyp. |
| **Linux** | `build-essential`, `python3` (package names vary by distro). |
| **macOS** | Xcode Command Line Tools (`xcode-select --install`). |

## Proof demo

```bash
npx ts-node src/index.ts
```

Demonstrates: YAML packet compression; CodeRank pruning; **episodic GC** (duplicate hypothesis → `AUTO_RULE_*`, episodes purged); **blast-radius** stale marking (e.g. editing `src/schemas.ts` cascades to dependents).

### Smoke tests

```bash
npm ci
npm run smoke
```

Runs end-to-end checks (ingest, packets, expand handles, ledger ops, delta packets, recall, team ledger roundtrip, CI apply). Expect **`=== ALL SMOKE CHECKS PASSED ===`**.

### npm scripts

Run from the repo root after **`npm ci`**:

| Script | Command | Purpose |
|--------|---------|---------|
| **Smoke test** | `npm run smoke` | Full end-to-end validation (recommended after install or before a release). |
| **Typecheck** | `npm run typecheck` | `tsc --noEmit` — no emit; requires `node_modules` with TypeScript. |
| **CI ingest** | `npm run ci-ingest -- <repo_root>` | Apply a CI verdict to `validation_registry` (set env vars first; see [Environment variables](#environment-variables-reference)). |
| **Install hints** | `npm run install:hints` | Prints OS-specific env and path examples (Windows vs Linux/macOS). |
| **Clean** | `npm run clean` | Deletes `./node_modules` via Node (safe on all platforms). |

The **`mimir-mcp`** binary is declared in `package.json` and invoked by Cursor as `node …/bin/mimir-mcp.js` (see [MCP](#mcp-cursor-and-other-clients)).

## Design goals (limits addressed)

- **Scale**: Rank by centrality + coverage; don’t dump all dependents — top symbols per budget.
- **Episodic bloat**: Consolidation collapses many failures into one rule.
- **Token cost**: YAML packets vs. JSON; **delta** follow-ups shrink repeat context for the same `task_id`.
- **Static vs. runtime**: Telemetry can overweight paths that actually run or fail.

---

## MCP (Cursor and other clients)

Native MCP server: `node <MIMIR_REPO>/bin/mimir-mcp.js` after `npm ci` (or `npm install`) in the Mimir repo. Server version **4.0.6**.

One-shot **Obsidian backfill** (SQLite → `10_KGRAPH/KG/<slug>/`): copy `.mimir/config.example.yaml` to `.mimir/config.yaml`, set `vault_path`, then `npm run obsidian-backfill` (or MCP tool **`mimir_obsidian_backfill`**).

### Install vs. ingest

| | |
|--|--|
| **Install** | Clone repo, run **`npm ci`** in the Mimir directory — does **not** index your app. |
| **Ingest** | Call **`mimir_ingest`** with **absolute path** to each project root. Expect **`structural_graph nodes: N`** (**N > 0**) and **`database:`** in the response. |
| **Without ingest** | Ledger tools work (decisions, episodes, validations, packets from those), but **no `FILE:` / `SYMBOL:` graph** for that repo until ingested. Re-ingest after large refactors or stale graph. |

### Cursor MCP entry

**Settings → MCP → Add server:** type `command`, name `mimir`, command `node`, args `["<ABSOLUTE_PATH_TO_THIS_REPO>/bin/mimir-mcp.js"]`.

### Tools

| Tool | Purpose |
|------|---------|
| `mimir_ingest` | Build/update CodeRank graph for a repo path. |
| `mimir_build_packet` | YAML context packet (`task_id`, `objective`, `task_type`, `mode`, `symbols`, `files`). Optional **`packet_mode`**: `full` (default) or **`delta`** (diff vs. last snapshot for this `task_id`). Optional **`include_git_path_diff`**: include paths changed since ingest HEAD (requires prior ingest with git metadata). |
| `mimir_expand_handle` | Expand `RULE:` / `CONSTRAINT:` / … / `TEST:` / `VERIFIER:` / `SUBSYSTEM:` / `ATTEMPT:` / `FILE:` / `SYMBOL:` within token budget. |
| `mimir_record_episode` | Task outcome, verdicts, failed hypotheses. |
| `mimir_record_decision` | Intent ledger (RULE, CONSTRAINT, INVARIANT, DECISION, NON_GOAL). |
| `mimir_record_validation` | `validation_registry` — **`TEST:`** / **`VERIFIER:`** in packets; optional **provenance** (`commit_sha`, `ci_run_url`, `ci_run_id`). |
| `mimir_record_subsystem_card` | Domain summaries — **`SUBSYSTEM:…`** handles in **`subsystem_cards`** (id must start with **`SUBSYSTEM:`**). |
| `mimir_record_trace` | Execution trace → boosts **coverage** on matching graph symbols (`telemetry_traces`). |
| `mimir_query_memory` | JSON snapshot: **`all`** / intents / validations / episodes / **subsystems** / **traces** (capped). |
| `mimir_delete_memory` | Delete one row: intent, validation, episode, **subsystem**, or **trace** by id. |
| `mimir_recall_similar` | **Offline** TF–IDF-style similarity over intents + episodes (`query`, optional `top_k`). No embedding API. |
| `mimir_apply_ci_result` | Upsert a validation by id from CI: **`validation_id`**, **`verdict`** (`PASS` / `FAIL` / `PENDING`), optional provenance fields. |
| `mimir_team_ledger_export` | Returns JSON export of intents + validations (for files or VCS). |
| `mimir_team_ledger_import` | Merge a prior export JSON into this DB (`INSERT OR REPLACE` per row). |
| `mimir_run_gc` | Episodic consolidation (AUTO_RULE synthesis, episode trim). |

**Writes:** MCP blocks obvious **secrets** in recorded text (API keys, PATs, PEM headers, AWS key ids). To override (not recommended): **`MIMIR_ALLOW_UNSAFE_SECRET_RECORDING=1`**.

**Ledger extras:** **`mimir_record_decision`** supports **`binding`**: `hard` (surfaced first in packets) vs `soft`, and optional **`reference_url`** (ADR/issue). **`mimir_record_episode`** supports optional **`commit_sha`**, **`ci_run_url`**, **`ci_run_id`**, **`repo_head_at_close`**.

**Packets:** **`subsystem_cards`** lists ranked **`SUBSYSTEM:`** handles. **`selection_meta.continuation`** records **`previous_packet_task_id`** and **`same_task_as_previous`**. **`selection_meta.ingest_freshness`** compares stored ingest git HEAD to live repo HEAD — if they differ, re-run **`mimir_ingest`**. **`selection_meta.packet_mode`** may be `full` or `delta`. **`open_questions`** may list near-duplicate intent descriptions.

### Delta packets and git path hints

- First **`mimir_build_packet`** for a given **`task_id`** is always a **full** packet; the server stores a snapshot for diffing.
- Later calls with **`packet_mode`: `delta`** emit a compact **YAML diff** vs. that snapshot (plus continuation/freshness as usual).
- With **`include_git_path_diff`: true** (and a successful ingest that recorded git HEAD), the packet can include **paths changed in git** since that HEAD — useful when graph and ledger need file-level awareness without a full re-ingest.

### Offline recall (`mimir_recall_similar`)

Use for “what did we decide before?” style questions without building a full packet. Scoring is **TF–IDF-style** cosine similarity over concatenated intent and episode text — **no network**, no API keys for embeddings.

### CI validation recording

1. Register tests/verifiers with **`mimir_record_validation`** so each has a stable **`id`** in `validation_registry`.
2. In the **application repo** (not necessarily the Mimir repo), add **`.mimir/ci-mapping.yaml`** mapping CI job names to those ids. See **`.mimir/ci-mapping.example.yaml`** in this repo.
3. From CI, run:

   ```bash
   npm run ci-ingest -- <absolute_repo_root>
   ```

   (Install Mimir or copy the script; set env — see **Environment variables** below.)

4. Or call **`mimir_apply_ci_result`** from automation that can use MCP tools directly.

### Team ledger (share intents + validations)

- **`mimir_team_ledger_export`** / **`mimir_team_ledger_import`** move JSON between databases or teammates.
- **Startup merge:** set **`MIMIR_TEAM_LEDGER_IMPORT`** to an absolute path of a JSON file; it is merged when the MCP/API **`init`** runs.
- **Auto-export on write:** set **`MIMIR_TEAM_LEDGER_EXPORT_PATH`**; after **`mimir_record_decision`** or **`mimir_record_validation`**, the file is rewritten.

### Graph coverage (`mimir_expand_handle`)

- **TS/JS**: `ts-morph` over `**/*.{ts,js}` (imports, classes, interfaces, functions). Paths under **`node_modules`**, **`dist`**, **`build`**, **`.next`**, **`coverage`**, **`vendor`**, **`__generated__`**, minified `.min.js`, etc., are **skipped** so CodeRank targets source.
- **Python**: `**/*.py` (skips `.git`, `node_modules`, `.venv`, `__pycache__`, …): `FILE:` per file; top-level `def` / `async def` / `class` → `SYMBOL:relative/path.py::name` (regex; not a full type system).
- **`FILE:`** ids are **absolute** on disk; expansion also matches **relative** paths by suffix. Re-ingest after upgrading Mimir if you need refreshed Python indexing.

### Database

Single SQLite file:

- **Default:** `<MIMIR_repo>/mimir.db` (next to `package.json`, **not** `cwd`).
- **Override:** **`MIMIR_DB_PATH`** (absolute) in the MCP process env.

Stderr on start: `[mimir-mcp] platform: …` then `[mimir-mcp] database: /path/to/mimir.db`.

### Obsidian WIKI mirror (optional)

**SQLite (`mimir.db`) stays the source of truth.** Obsidian is a **per-project WIKI**: Markdown + wikilinks for graph view, search, and reading—not a replacement database.

#### Configuration file (easiest for new users)

1. Copy **`.mimir/config.example.yaml`** → **`.mimir/config.yaml`** in the Mimir repo (same folder as `package.json`).
2. Set **`obsidian.enabled: true`** and **`obsidian.vault_path`** to your vault’s **absolute** path (forward slashes are fine on Windows).
3. Adjust **`obsidian.project_slug`** if this MCP instance is for a repo other than Mimir (e.g. `anima-linux`).
4. Restart the MCP server.

**`.mimir/config.yaml`** is **gitignored** so local paths are not committed. Optional **`MIMIR_CONFIG_PATH`** points to a config file anywhere on disk.

**Precedence:** **`MIMIR_OBSIDIAN_VAULT_PATH`** (env) overrides the file vault path. **`MIMIR_OBSIDIAN_DISABLED=1`** turns the mirror off even if the file says enabled. Other Obsidian env vars override the matching file fields.

#### Default layout (when a vault path resolves)

- **Mirror root:** `<vault>/10_KGRAPH/KG/<project_slug>/` with `Episodes/`, `Tasks/`, `Intents/`, `Validations/`, `Subsystems/`, `Traces/`, and **`MOC.md`**.
- **Project slug:** **`MIMIR_OBSIDIAN_PROJECT_SLUG`** (default **`mimir`**). Use another repo’s slug when that project uses the same vault.
- **Registry stub:** **`01_PROJECTS/<slug>.md`** is created if missing (links into the KG mirror).

**Overrides:**

- **`MIMIR_OBSIDIAN_MIRROR_REL`** — full path under the vault (e.g. `Mimir` or `10_KGRAPH/KG/custom`). Wins over defaults.
- **`MIMIR_OBSIDIAN_BASE`** — legacy alias: if set and **`MIMIR_OBSIDIAN_MIRROR_REL`** is unset, mirror root is `<vault>/<BASE>` (e.g. `Mimir` for the old flat layout).

Set **`MIMIR_OBSIDIAN_VAULT_PATH`** to your vault root (e.g. `N:\WIKI\atlas_wiki\vault`).

**Limitations:** **`mimir_team_ledger_import`** and **`mimir_run_gc`** (AUTO_RULE) do not sync to Obsidian in this version unless rows are written again through the normal MCP tools.

### Environment variables (reference)

Values are the same on every OS; **shell syntax differs** (e.g. Windows `set NAME=value` vs. Linux/macOS `export NAME=value`). Run **`npm run install:hints`** for copy-paste examples for your machine.

| Variable | Purpose |
|----------|---------|
| `MIMIR_DB_PATH` | Absolute path to SQLite DB (default: `mimir.db` next to Mimir `package.json`). |
| `MIMIR_ALLOW_UNSAFE_SECRET_RECORDING` | Set to `1` to allow secret-like strings in MCP writes (not recommended). |
| `MIMIR_TEAM_LEDGER_IMPORT` | Absolute path to JSON file merged at **`init`** (intents + validations). |
| `MIMIR_TEAM_LEDGER_EXPORT_PATH` | Absolute path; rewritten after decision/validation writes when set. |
| `MIMIR_CONFIG_PATH` | Absolute path to a YAML config file (optional; default `<MIMIR repo>/.mimir/config.yaml`). |
| `MIMIR_OBSIDIAN_VAULT_PATH` | Absolute vault path; **overrides** `obsidian.vault_path` in config (optional). |
| `MIMIR_OBSIDIAN_DISABLED` | Set to `1` to disable WIKI mirror regardless of config. |
| `MIMIR_OBSIDIAN_PROJECT_SLUG` | Folder name under `10_KGRAPH/KG/` (default **`mimir`**). |
| `MIMIR_OBSIDIAN_MIRROR_REL` | Override mirror root relative to vault (wins over default wiki path). |
| `MIMIR_OBSIDIAN_BASE` | Legacy: single folder under vault if `MIRROR_REL` unset (e.g. **`Mimir`**). |

**`npm run ci-ingest`** (run from Mimir repo with `ts-node`):

| Variable | Purpose |
|----------|---------|
| `MIMIR_DB_PATH` | Target SQLite DB (same as MCP). |
| `MIMIR_VALIDATION_ID` | Explicit validation id (skips mapping file). |
| `GITHUB_JOB` | Job name; resolved via `.mimir/ci-mapping.yaml` → `validation_id`. |
| `CI_VERDICT` | `PASS`, `FAIL`, or `PENDING`. |
| `GITHUB_SHA`, `GITHUB_RUN_ID`, `CI_RUN_URL` | Optional provenance strings. |

### Reset / cleanup

Stop MCP, then delete that `mimir.db`, use **`mimir_delete_memory`**, or delete rows from `intent_ledger`, `episode_journal`, `validation_registry`, `subsystem_cards`, `telemetry_traces`, `structural_graph` as needed.

---

## License

[ISC](https://opensource.org/licenses/ISC) — see `package.json` (`"license": "ISC"`).
