import { config } from "../../package.json";
import { joinPath, makeDirectory, pathExists, readTextFile, writeTextFile } from "./os";

async function getDebugFilePath() {
  const dir = joinPath(Zotero.DataDirectory.dir, config.addonRef);
  if (!(await pathExists(dir))) {
    await makeDirectory(dir, { createAncestors: true });
  }
  return joinPath(dir, "debug.log");
}

export async function debugLog(message: string) {
  try {
    const file = await getDebugFilePath();
    const line = `[${new Date().toISOString()}] ${message}\n`;
    let existing = "";
    if (await pathExists(file)) {
      existing = await readTextFile(file);
    }
    const next = `${existing}${line}`.split("\n").slice(-200).join("\n");
    await writeTextFile(file, next);
  } catch (error) {
    Zotero.logError(error);
  }
}

export async function debugLogError(prefix: string, error: any) {
  const message =
    error && typeof error === "object"
      ? `${prefix}: ${error.message || String(error)}\n${error.stack || ""}`
      : `${prefix}: ${String(error)}`;
  await debugLog(message);
}
