import * as fs from "fs/promises";
import { StorageLayer } from "./storage";
import { IntentDecision, ValidationEntry } from "./schemas";

export type TeamLedgerFile = {
  version: 1;
  exported_at: string;
  intents: IntentDecision[];
  validations: ValidationEntry[];
};

export async function exportTeamLedgerJson(storage: StorageLayer): Promise<string> {
  const intents = await storage.getIntents();
  const validations = await storage.getValidations();
  const payload: TeamLedgerFile = {
    version: 1,
    exported_at: new Date().toISOString(),
    intents,
    validations,
  };
  return JSON.stringify(payload, null, 2);
}

export async function exportTeamLedgerToFile(storage: StorageLayer, filePath: string): Promise<void> {
  const json = await exportTeamLedgerJson(storage);
  await fs.writeFile(filePath, json, "utf8");
}

export async function importTeamLedgerJson(storage: StorageLayer, json: string): Promise<void> {
  const o = JSON.parse(json) as TeamLedgerFile;
  if (o.version !== 1 || !Array.isArray(o.intents) || !Array.isArray(o.validations)) {
    throw new Error("Invalid team ledger JSON (expected version 1 with intents[] and validations[])");
  }
  for (const i of o.intents) await storage.saveIntent(i);
  for (const v of o.validations) await storage.saveValidation(v);
}

export async function importTeamLedgerFromFile(storage: StorageLayer, filePath: string): Promise<void> {
  const json = await fs.readFile(filePath, "utf8");
  await importTeamLedgerJson(storage, json);
}
