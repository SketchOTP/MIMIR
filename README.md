# Token-Efficient, Structure-First Memory System for AI Coding (V2)

## A. Architecture

**System Overview**
Mimir V2 extends the structure-first memory system with ultra-compression, graph-based context routing, and automatic garbage collection. It ensures that even in massive codebases (10k+ files), the Context Packet remains strictly bounded and highly relevant.

**V2 Component Map Upgrades**
*   **Repo Cartographer**: Now performs a **CodeRank pass** (in-degree centrality) to identify core utility files vs. long-tail endpoints.
*   **Telemetry Ingestor**: New module that reads execution traces to boost node **coverage weights**. Runtime truth overrides static AST guesses.
*   **Lifecycle Manager**: 
    *   **Blast-Radius Invalidation**: When a file changes, all its dependents are marked `STALE_UPSTREAM_CHANGE`.
    *   **Episodic Consolidation**: Runs background GC to synthesize repeated `failed_hypotheses` into permanent `IntentLedger` Rules, purging bloated logs.
*   **Context Packet Builder**: 
    *   Now serializes to ultra-dense **YAML** instead of JSON to save ~30% token overhead.
    *   Uses **CodeRank Pruning** to strictly slice the top 5 highest-weighted symbols based on Centrality and Coverage, dropping the long tail.

**Storage Strategy**
Still utilizing SQLite for immediate local persistence, with enhanced schema columns for `centrality`, `coverage`, `churn`, and `status`.

---

## B. V2 Schemas

*   **SubsystemCard**: For 100-token LLM-generated summaries of entire domains.
*   **TraceEntry**: For telemetry execution matching.
*   **StructuralNode Upgrades**: `centrality`, `coverage`, `churn`, and `status: "VALID" | "STALE_UPSTREAM_CHANGE"`.

---

## C. Proof (The V2 Demo)

Run the demo via: `npx ts-node src/index.ts`

**Key V2 Capabilities Proven:**
1.  **YAML Ultra-Compression**: The packet is printed in dense YAML format, stripping brackets and quotes for token efficiency.
2.  **CodeRank Pruning**: Only the highest-weighted related symbols make it into the context packet.
3.  **Episodic Consolidation (GC)**: The demo intentionally fails twice with the hypothesis "Adding a delay before refresh fixes it". The Lifecycle Manager successfully detects this, creates an `AUTO_RULE`, and purges the raw episodic logs to prevent prompt bloat in the future.
4.  **Blast-Radius Invalidation**: Modifying `src/schemas.ts` cascades through the graph, capable of marking all dependents as stale.

---

## D. Addressing AI Coding Context Limits

*   **10,000 File Scale**: Solved by CodeRank. We no longer list all dependents. We score them by centrality and runtime coverage and only inject the top 5 into the `SCOUT` packet.
*   **Episodic Bloat**: Solved by Consolidation. 100 failed attempts become 1 constitutional rule.
*   **JSON Token Tax**: Solved by native YAML formatting.
*   **Static AST Lies**: Solved by Telemetry ingestion. If a path is hit in runtime (or fails in runtime), its weight is doubled, forcing it into the Context Packet over unused static dependencies.

---

## E. Using with Cursor (MCP Server)

Mimir V2 runs natively as a Model Context Protocol (MCP) server, allowing Cursor (and other MCP-compatible clients) to proactively govern memory and retrieve ultra-compressed context.

### Installation

1. Clone or copy this repository to your local machine (e.g., `~/tools/mimir`).
2. Run `npm install`.
3. The executable is located at `./bin/mimir-mcp.js`.

### Adding to Cursor Settings

1. Open Cursor and navigate to **Settings > Cursor Settings > Features > MCP Settings** (or equivalent MCP tool tab).
2. Click **Add New MCP Server**.
3. Enter the following details:
   - **Type:** `command`
   - **Name:** `mimir`
   - **Command:** `node`
   - **Args:** `["<PATH_TO_MIMIR_REPO>/bin/mimir-mcp.js"]` *(replace `<PATH_TO_MIMIR_REPO>` with the absolute path to this folder).*

### Available MCP Tools inside Cursor
Once attached, the Cursor Agent will have access to the following capabilities:
- **`mimir_ingest`**: Scan the local codebase into the CodeRank structural graph.
- **`mimir_build_packet`**: Request a YAML `ContextPacket` based on a task (e.g., `bug_fix`).
- **`mimir_expand_handle`**: Lazily expand concise references (e.g., `TEST:xyz`) if the current budget allows.
- **`mimir_record_episode`**: Log task outcomes, assumed paths, and importantly, failed hypotheses.
- **`mimir_record_decision`**: Hardcode architectural invariants into the Constitutional Intent Ledger.
- **`mimir_run_gc`**: Manually trigger Episodic GC to synthesize repeated failures into permanent Rules.

### Ingest coverage and `mimir_expand_handle`

- **TypeScript / JavaScript**: Parsed with `ts-morph` (imports, classes, interfaces, functions) under `**/*.{ts,js}`.
- **Python**: After the TS/JS pass, all `**/*.py` files under the ingest root are scanned (skipping common dirs like `.git`, `node_modules`, `.venv`). Each file becomes a `FILE:` node; top-level `def` / `async def` / `class` names become `SYMBOL:relative/path.py::name` entries (regex-based, not a full type system).
- **Stored `FILE:` ids** use the **absolute** path on disk. The packet may show relative paths; **`mimir_expand_handle`** also resolves `FILE:relative/path` by suffix match against ingested files.
- **Re-ingest** after pulling a new Mimir version if you need updated Python indexing: run `mimir_ingest` again on your project root.

### Clearing local MCP data (smoke tests, experiments)

Persistent state lives in `mimir.db` in the process **current working directory** (where Cursor launches the MCP server). To remove test rules/episodes/graph data, delete that file when the server is stopped, or use SQLite to delete specific rows from `intent_ledger` / `episode_journal` / `structural_graph`.