#!/usr/bin/env node
import { Mode, RunOptions } from "./types";
import { acceptTask, readWorkflowStatus, rejectTask, runWorkflow } from "./workflow";

const path = require("node:path");

function help(): string {
  return [
    "Codex Development Workflow",
    "",
    "Commands:",
    "  run --tasks <file> --task <id> [options]",
    "  run --tasks <file> --mode night [options]",
    "  resume --tasks <file> --mode <interactive|night> [options]",
    "  status [--cwd <directory>] [--state-dir <directory>]",
    "  accept --task <id> [--cwd <directory>] [--state-dir <directory>]",
    "  reject --task <id> --reason <text> [--cwd <directory>] [--state-dir <directory>]",
    "",
    "Options:",
    "  --cwd <directory>                 Target repository (default: current directory)",
    "  --state-dir <directory>           State directory relative to cwd (default: .codex/workflow)",
    "  --mode <interactive|night>        Default: interactive",
    "  --task <id>                       Required for run, accept, and reject",
    "  --reason <text>                   Required for reject",
    "  --max-attempts <n>                Default: 3",
    "  --max-tasks <n>                   Night Shift cap; default: 10",
    "  --total-runtime <seconds>         Total Night Shift runtime; default: 28800 (8 hours)",
    "  --max-runtime <seconds>           Alias for --total-runtime",
    "  --max-stagnant-attempts <n>       Default: 2",
    "  --idle-timeout <seconds>          Default: 900",
    "  --hard-timeout <seconds>          Default: 7200",
    "  --checkpoint                      Opt in to accepted Git checkpoints",
    "  --allow-dirty                     Allow a dirty Night Shift with baseline separation; disables checkpoints",
    "  --reclaim-stale-lock              Reclaim a dead/invalid workflow lock after inspection",
    "  --codex-bin <path-or-name>        Default: codex",
    ""
  ].join("\n");
}

function flags(argumentsList: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const item = argumentsList[index];
    if (!item.startsWith("--")) throw new Error(`Unknown argument: ${item}`);
    const key = item.slice(2);
    if (["checkpoint", "allow-dirty", "reclaim-stale-lock"].includes(key)) {
      result[key] = true;
      continue;
    }
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    result[key] = value;
    index += 1;
  }
  return result;
}

function positiveInteger(value: string | boolean | undefined, fallback: number, option: string, allowZero = false): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error(`--${option} must be a non-negative integer.`);
  const parsed = Number(value);
  if ((!allowZero && parsed < 1) || !Number.isSafeInteger(parsed)) throw new Error(`--${option} must be ${allowZero ? "non-negative" : "positive"}.`);
  return parsed;
}

function options(command: "run" | "resume", parsed: Record<string, string | boolean>): RunOptions {
  const cwd = path.resolve(typeof parsed.cwd === "string" ? parsed.cwd : process.cwd());
  const taskFileArgument = parsed.tasks;
  if (typeof taskFileArgument !== "string") throw new Error("--tasks <file> is required.");
  const mode = (parsed.mode ?? "interactive") as Mode;
  if (mode !== "interactive" && mode !== "night") throw new Error("--mode must be interactive or night.");
  return {
    cwd,
    taskFile: path.resolve(cwd, taskFileArgument),
    stateDir: typeof parsed["state-dir"] === "string" ? parsed["state-dir"] : undefined,
    mode,
    taskId: typeof parsed.task === "string" ? parsed.task : undefined,
    resume: command === "resume",
    maxAttempts: positiveInteger(parsed["max-attempts"], 3, "max-attempts"),
    maxTasks: positiveInteger(parsed["max-tasks"], mode === "night" ? 10 : 0, "max-tasks", mode !== "night"),
    maxStagnantAttempts: positiveInteger(parsed["max-stagnant-attempts"], 2, "max-stagnant-attempts"),
    idleTimeoutSeconds: positiveInteger(parsed["idle-timeout"], 900, "idle-timeout", true),
    hardTimeoutSeconds: positiveInteger(parsed["hard-timeout"], 7200, "hard-timeout", true),
    checkpoint: parsed.checkpoint === true,
    allowDirty: parsed["allow-dirty"] === true,
    reclaimStaleLock: parsed["reclaim-stale-lock"] === true,
    codexBin: typeof parsed["codex-bin"] === "string" ? parsed["codex-bin"] : "codex",
    totalRuntimeSeconds: positiveInteger(parsed["total-runtime"] ?? parsed["max-runtime"], 8 * 60 * 60, "total-runtime", true)
  };
}

async function main(): Promise<void> {
  const [command = "help", ...argumentsList] = process.argv.slice(2);
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(help());
    return;
  }
  const parsed = flags(argumentsList);
  if (command === "status") {
    const cwd = path.resolve(typeof parsed.cwd === "string" ? parsed.cwd : process.cwd());
    const state = readWorkflowStatus(cwd, typeof parsed["state-dir"] === "string" ? parsed["state-dir"] : undefined);
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return;
  }
  if (command === "accept" || command === "reject") {
    const taskId = parsed.task;
    if (typeof taskId !== "string") throw new Error(`--task <id> is required for ${command}.`);
    const cwd = path.resolve(typeof parsed.cwd === "string" ? parsed.cwd : process.cwd());
    const stateDir = typeof parsed["state-dir"] === "string" ? parsed["state-dir"] : undefined;
    const state = command === "accept"
      ? acceptTask(cwd, taskId, stateDir)
      : rejectTask(cwd, taskId, typeof parsed.reason === "string" ? parsed.reason : "", stateDir);
    process.stdout.write(`Task ${taskId} ${command === "accept" ? "accepted" : "rejected"}; workflow status: ${state.status}.\n`);
    return;
  }
  if (command !== "run" && command !== "resume") throw new Error(`Unknown command: ${command}`);
  const state = await runWorkflow(options(command, parsed));
  for (const warning of state.preflightWarnings) process.stderr.write(`workflow warning: ${warning}\n`);
  process.stdout.write(`Workflow ${state.status}: ${state.stopReason ?? "no stop reason"}\n`);
}

main().catch((error) => {
  process.stderr.write(`workflow error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
