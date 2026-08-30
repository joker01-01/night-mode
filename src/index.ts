#!/usr/bin/env node
import { Mode, ProjectMemoryKind, ReadinessLevel, RunOptions } from "./types";
import { acceptTask, readWorkflowStatus, rejectTask, runWorkflow } from "./workflow";
import { assessReadiness } from "./readiness";
import { loadTaskDocument } from "./tasks";
import { workflowPaths } from "./storage";
import { acquireLock, releaseLock } from "./lock";
import { addProjectMemory, archiveProjectMemory, parseMemorySource, readProjectMemory, revalidateProjectMemory } from "./project-memory";

const path = require("node:path");

function help(): string {
  return [
    "Codex Development Workflow",
    "",
    "Commands:",
    "  run --tasks <file> --task <id> [options]",
    "  run --tasks <file> --mode night [options]",
    "  resume --tasks <file> --mode <interactive|night> [options]",
    "  readiness --tasks <file> [--min-readiness <0-4>] [--cwd <directory>]",
    "  status [--cwd <directory>] [--state-dir <directory>]",
    "  accept --task <id> [--cwd <directory>] [--state-dir <directory>]",
    "  reject --task <id> --reason <text> [--cwd <directory>] [--state-dir <directory>]",
    "  memory list [--cwd <directory>] [--state-dir <directory>]",
    "  memory validate [--cwd <directory>] [--state-dir <directory>]",
    "  memory add --kind <decision|learning|constraint> --statement <text> --tags <csv> --source <path:start-end> [--retention-days <n>]",
    "  memory archive --id <memory-id> --reason <text> [--cwd <directory>] [--state-dir <directory>]",
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
    "  --min-readiness <0-4>             Night minimum; default: 2",
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
  const minReadinessLevel = positiveInteger(parsed["min-readiness"], mode === "night" ? 2 : 0, "min-readiness", true);
  if (minReadinessLevel > 4) throw new Error("--min-readiness must be an integer from 0 through 4.");
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
    totalRuntimeSeconds: positiveInteger(parsed["total-runtime"] ?? parsed["max-runtime"], 8 * 60 * 60, "total-runtime", true),
    minReadinessLevel: minReadinessLevel as RunOptions["minReadinessLevel"]
  };
}

async function main(): Promise<void> {
  const [command = "help", ...argumentsList] = process.argv.slice(2);
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(help());
    return;
  }
  if (command === "memory") {
    const [action, ...memoryArguments] = argumentsList;
    if (!action) throw new Error("memory requires list, validate, add, or archive.");
    const memoryFlags = flags(memoryArguments);
    const cwd = path.resolve(typeof memoryFlags.cwd === "string" ? memoryFlags.cwd : process.cwd());
    const paths = workflowPaths(cwd, typeof memoryFlags["state-dir"] === "string" ? memoryFlags["state-dir"] : undefined);
    if (action === "list") {
      process.stdout.write(`${JSON.stringify(readProjectMemory(paths), null, 2)}\n`);
      return;
    }
    if (!["validate", "add", "archive"].includes(action)) throw new Error(`Unknown memory command: ${action}`);
    acquireLock(paths, memoryFlags["reclaim-stale-lock"] === true, { runId: `memory-${action}`, target: cwd, commandContext: process.argv.join(" ") });
    try {
      if (action === "validate") {
        const store = revalidateProjectMemory(paths);
        process.stdout.write(`Project memory revalidated: ${store.entries.length} retained entries. Report: ${paths.projectMemoryReportFile}\n`);
        return;
      }
      if (action === "add") {
        const kind = memoryFlags.kind;
        if (typeof kind !== "string" || !["decision", "learning", "constraint"].includes(kind)) throw new Error("memory add requires --kind <decision|learning|constraint>.");
        if (typeof memoryFlags.statement !== "string") throw new Error("memory add requires --statement <text>.");
        if (typeof memoryFlags.tags !== "string") throw new Error("memory add requires --tags <comma-separated-tags>.");
        if (typeof memoryFlags.source !== "string") throw new Error("memory add requires --source <relative-path:start-end>.");
        const entry = addProjectMemory(paths, {
          kind: kind as ProjectMemoryKind,
          statement: memoryFlags.statement,
          tags: memoryFlags.tags.split(","),
          citations: [parseMemorySource(memoryFlags.source)]
        }, positiveInteger(memoryFlags["retention-days"], 28, "retention-days", true));
        process.stdout.write(`Project memory ${entry.id} is ${entry.status}. Report: ${paths.projectMemoryReportFile}\n`);
        return;
      }
      if (typeof memoryFlags.id !== "string") throw new Error("memory archive requires --id <memory-id>.");
      if (typeof memoryFlags.reason !== "string") throw new Error("memory archive requires --reason <text>.");
      const entry = archiveProjectMemory(paths, memoryFlags.id, memoryFlags.reason);
      process.stdout.write(`Project memory ${entry.id} archived. Report: ${paths.projectMemoryReportFile}\n`);
      return;
    } finally {
      releaseLock(paths);
    }
  }
  const parsed = flags(argumentsList);
  if (command === "readiness") {
    const cwd = path.resolve(typeof parsed.cwd === "string" ? parsed.cwd : process.cwd());
    if (typeof parsed.tasks !== "string") throw new Error("--tasks <file> is required for readiness.");
    const minimumLevel = positiveInteger(parsed["min-readiness"], 2, "min-readiness", true);
    if (minimumLevel > 4) throw new Error("--min-readiness must be an integer from 0 through 4.");
    const loaded = loadTaskDocument(path.resolve(cwd, parsed.tasks));
    const paths = workflowPaths(cwd, typeof parsed["state-dir"] === "string" ? parsed["state-dir"] : undefined);
    const assessment = await assessReadiness(paths, loaded.document, loaded.file, minimumLevel as ReadinessLevel);
    process.stdout.write(`Readiness level ${assessment.level}/4; required ${assessment.minimumLevel}/4; ${assessment.ready ? "PASS" : "FAIL"}. Report: ${paths.readinessReportFile}\n`);
    if (!assessment.ready) process.exitCode = 2;
    return;
  }
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
