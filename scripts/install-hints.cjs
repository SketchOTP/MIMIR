#!/usr/bin/env node
/**
 * Prints OS-specific commands for env vars and cleaning node_modules.
 * Run: node scripts/install-hints.cjs   or   npm run install:hints
 */
const p = process.platform;
const isWin = p === "win32";
const label = isWin ? "Windows" : p === "darwin" ? "macOS" : "Linux";

console.log("");
console.log(`Detected OS: ${label} (${p})`);
console.log("");

if (isWin) {
  console.log("--- Windows (cmd.exe) ---");
  console.log("  Install / refresh dependencies (from repo root):");
  console.log("    npm ci");
  console.log("");
  console.log("  Clean node_modules (cross-platform, from repo root):");
  console.log("    npm run clean");
  console.log("");
  console.log("  Set env vars for one session (example paths use / — valid in cmd):");
  console.log("    set MIMIR_DB_PATH=C:/path/to/mimir.db");
  console.log("    set CI_VERDICT=PASS");
  console.log("");
  console.log("  PowerShell (session variables):");
  console.log('    $env:MIMIR_DB_PATH = "C:/path/to/mimir.db"');
  console.log("");
  console.log("  CI ingest (cmd, from Mimir repo root):");
  console.log("    set MIMIR_DB_PATH=C:/path/to/mimir.db");
  console.log("    set CI_VERDICT=PASS");
  console.log("    set MIMIR_VALIDATION_ID=my_test_id");
  console.log("    npm run ci-ingest -- C:/path/to/app/repo");
} else {
  console.log("--- Linux / macOS (bash/zsh) ---");
  console.log("  Install / refresh dependencies (from repo root):");
  console.log("    npm ci");
  console.log("");
  console.log("  Clean node_modules (cross-platform, from repo root):");
  console.log("    npm run clean");
  console.log("");
  console.log("  Set env vars for one session (example):");
  console.log("    export MIMIR_DB_PATH=/path/to/mimir.db");
  console.log("    export CI_VERDICT=PASS");
  console.log("");
  console.log("  CI ingest (from Mimir repo root):");
  console.log("    export MIMIR_DB_PATH=/path/to/mimir.db");
  console.log("    export CI_VERDICT=PASS");
  console.log("    export MIMIR_VALIDATION_ID=my_test_id");
  console.log("    npm run ci-ingest -- /path/to/app/repo");
}
console.log("");
