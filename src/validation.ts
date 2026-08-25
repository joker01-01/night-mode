import { TaskDefinition, ValidationResult, WorkflowPaths } from "./types";
import { appendEvent, ensureDir } from "./storage";
import { spawnAndWatch } from "./process";

const path = require("node:path");

export async function runValidation(paths: WorkflowPaths, task: TaskDefinition, attempt: number, hardTimeoutSeconds: number): Promise<ValidationResult> {
  const commands = task.verification ?? [];
  if (commands.length === 0) return { status: "not_configured", commands: [] };
  const directory = path.join(paths.validationDir, task.id, `attempt-${attempt}`);
  ensureDir(directory);
  const results = [];
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    const outputFile = path.join(directory, `command-${index + 1}.log`);
    appendEvent(paths.eventsFile, "validation_started", { taskId: task.id, attempt, command });
    const result = await spawnAndWatch({ command, cwd: paths.cwd, outputFile, shell: true, idleTimeoutSeconds: 0, hardTimeoutSeconds });
    results.push(result);
    appendEvent(paths.eventsFile, "validation_finished", { taskId: task.id, attempt, command, exitCode: result.exitCode, timedOut: result.timedOut ?? null, outputFile });
  }
  return { status: results.every((result) => result.exitCode === 0 && !result.timedOut) ? "passed" : "failed", commands: results };
}
