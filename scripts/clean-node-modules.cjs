#!/usr/bin/env node
/**
 * Removes ./node_modules using Node's fs API (Windows + Linux + macOS).
 * Usage: node scripts/clean-node-modules.cjs
 */
const fs = require("fs");
const path = require("path");

const target = path.join(process.cwd(), "node_modules");
if (!fs.existsSync(target)) {
  console.error("No node_modules directory here — nothing to remove.");
  process.exit(0);
}
fs.rmSync(target, { recursive: true, force: true });
console.log("Removed node_modules. Run: npm ci");
