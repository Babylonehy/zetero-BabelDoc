import { makeLocalFile } from "./files";
import { joinPath, pathExists } from "../utils/os";

export interface ProcessResult {
  exitCode: number;
  commandLine: string;
}

export async function runCommand(
  commandTemplate: string,
  extraArgs: string[],
  taskID: string,
  options: { logPath?: string; env?: Record<string, string> } = {}
): Promise<ProcessResult> {
  const tokens = await normalizeCommand(splitCommand(commandTemplate));
  if (!tokens.length) {
    throw new Error("BabelDOC command is empty.");
  }

  const fullTokens = [...tokens, ...extraArgs];
  const commandLine = buildShellCommand(fullTokens);
  const redactedCommandLine = buildShellCommand(redactSensitiveTokens(fullTokens));
  const redirect = options.logPath
    ? ` >> ${shellQuote(options.logPath)} 2>&1`
    : "";
  const extraEnv = Object.entries(options.env || {})
    .filter(([, value]) => value != null && String(value).length > 0)
    .map(([key, value]) => `export ${key}=${shellQuote(String(value))};`)
    .join(" ");
  const executable = "/bin/zsh";
  const args = [
    "-lc",
    `export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; ${extraEnv} exec ${commandLine}${redirect}`
  ];
  const process = Components.classes["@mozilla.org/process/util;1"].createInstance(
    Components.interfaces.nsIProcess
  );

  process.init(makeLocalFile(executable));

  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (
      callback: typeof resolve | typeof reject,
      value: ProcessResult | Error
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      addon.data.activeProcesses.delete(taskID);
      callback(value as any);
    };

    const observer = {
      observe(subject: any, topic: string) {
        if (topic === "process-failed") {
          finish(reject, new Error(`Failed to launch process: ${executable}`));
          return;
        }

        finish(resolve, {
          exitCode: process.exitValue,
          commandLine: redactedCommandLine
        });
      }
    };

    addon.data.activeProcesses.set(taskID, {
      process,
      cancel() {
        try {
          process.kill();
        } catch (_error) {}
        finish(reject, new Error("Task cancelled."));
      }
    });

    try {
      process.runwAsync(args, args.length, observer, false);
    } catch (error) {
      finish(reject, error as Error);
    }
  });
}

export function cancelRunningTask(taskID: string) {
  const active = addon.data.activeProcesses.get(taskID);
  if (active?.cancel && typeof active.cancel === "function") {
    active.cancel();
    addon.data.activeProcesses.delete(taskID);
    return true;
  }
  return false;
}

async function resolveExecutable(token: string) {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error("BabelDOC command is empty.");
  }

  if (looksLikePath(trimmed)) {
    if (await pathExists(trimmed)) {
      return trimmed;
    }
    throw new Error(`Command not found: ${trimmed}`);
  }

  const pathValue = Services.env.get("PATH") || "";
  const pathEntries = [
    ...(Services.env.get("HOME")
      ? [
          joinPath(Services.env.get("HOME"), ".local", "bin"),
          joinPath(Services.env.get("HOME"), ".cargo", "bin")
        ]
      : []),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    ...pathValue
      .split(Services.appinfo.OS === "WINNT" ? ";" : ":")
      .filter(Boolean)
  ];
  const suffixes =
    Services.appinfo.OS === "WINNT"
      ? ["", ".exe", ".cmd", ".bat"]
      : [""];

  for (const entry of pathEntries) {
    for (const suffix of suffixes) {
      const candidate = joinPath(entry, `${trimmed}${suffix}`);
      if (await pathExists(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error(`Command not found in PATH: ${trimmed}`);
}

async function normalizeCommand(tokens: string[]) {
  if (!tokens.length) {
    return tokens;
  }

  if (tokens[0] !== "babeldoc") {
    return tokens;
  }

  try {
    await resolveExecutable(tokens[0]);
    return tokens;
  } catch (_error) {
    const uvx = await findOptionalExecutable("uvx");
    if (uvx) {
      return [uvx, "--from", "BabelDOC", "babeldoc", ...tokens.slice(1)];
    }
    return tokens;
  }
}

async function findOptionalExecutable(token: string) {
  try {
    return await resolveExecutable(token);
  } catch (_error) {
    return null;
  }
}

function looksLikePath(value: string) {
  return (
    value.startsWith("/") ||
    value.startsWith(".") ||
    value.includes("\\") ||
    value.includes("/")
  );
}

function splitCommand(input: string) {
  const result: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === "\\" && i + 1 < input.length) {
        current += input[++i];
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        result.push(current);
        current = "";
      }
      continue;
    }

    if (char === "\\" && i + 1 < input.length) {
      current += input[++i];
      continue;
    }

    current += char;
  }

  if (current) {
    result.push(current);
  }

  return result;
}

function buildShellCommand(tokens: string[]) {
  return tokens.map(shellQuote).join(" ");
}

function redactSensitiveTokens(tokens: string[]) {
  const next = [...tokens];
  for (let i = 0; i < next.length; i++) {
    if (next[i] === "--openai-api-key" && i + 1 < next.length) {
      next[i + 1] = "<redacted>";
    }
  }
  return next;
}

function shellQuote(value: string) {
  if (!value) {
    return "''";
  }
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}
