import { QualityGateDefinition, ReadinessRequirements, TaskDefinition, TaskDocument } from "./types";
import { readJson, sha256File } from "./storage";

const path = require("node:path");

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyString);
}

function dependencyList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function stringListOrEmpty(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function safeRelativeEvidencePath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  return !path.isAbsolute(value)
    && !/^[A-Za-z]:\//.test(normalized)
    && normalized !== ".."
    && !normalized.startsWith("../")
    && !normalized.includes("/../")
    && !normalized.startsWith(".codex/")
    && !["PROJECT_STATE.md", "MORNING_REPORT.md"].includes(normalized);
}

function validateQualityGates(value: unknown, taskId: string): QualityGateDefinition[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`Task ${taskId} qualityGates must be an array.`);
  const ids = new Set<string>();
  return value.map((raw, index) => {
    if (typeof raw !== "object" || raw === null) throw new Error(`Task ${taskId} quality gate ${index + 1} must be an object.`);
    const gate = raw as Record<string, unknown>;
    if (!nonEmptyString(gate.id) || !nonEmptyString(gate.command)) throw new Error(`Task ${taskId} quality gate ${index + 1} requires non-empty id and command.`);
    if (ids.has(gate.id)) throw new Error(`Task ${taskId} declares duplicate quality gate id: ${gate.id}.`);
    ids.add(gate.id);
    if (gate.kind !== "integration" && gate.kind !== "user_path") throw new Error(`Task ${taskId} quality gate ${gate.id} kind must be integration or user_path.`);
    if (!stringList(gate.evidencePaths)) throw new Error(`Task ${taskId} quality gate ${gate.id} evidencePaths must be a non-empty array of non-empty strings.`);
    for (const evidencePath of gate.evidencePaths) {
      if (!safeRelativeEvidencePath(evidencePath)) throw new Error(`Task ${taskId} quality gate ${gate.id} evidence path must stay inside the repository and outside controller-owned artifacts: ${evidencePath}`);
    }
    return { id: gate.id, kind: gate.kind, command: gate.command, evidencePaths: gate.evidencePaths };
  });
}

function validateReadiness(value: unknown): ReadinessRequirements | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) throw new Error("Task document readiness must be an object.");
  const readiness = value as Record<string, unknown>;
  if (!stringListOrEmpty(readiness.requiredCommands)) throw new Error("Task document readiness.requiredCommands must be an array of command names.");
  if (!readiness.requiredCommands.every((command) => /^[A-Za-z0-9._-]+$/.test(command))) throw new Error("Task document readiness.requiredCommands may contain command names only.");
  if (!stringListOrEmpty(readiness.requiredEnvironment)) throw new Error("Task document readiness.requiredEnvironment must be an array of environment-variable names.");
  if (!readiness.requiredEnvironment.every((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) throw new Error("Task document readiness.requiredEnvironment contains an invalid environment-variable name.");
  if (!['none', 'optional', 'required'].includes(String(readiness.network))) throw new Error("Task document readiness.network must be none, optional, or required.");
  let bootstrap: ReadinessRequirements["bootstrap"];
  if (readiness.bootstrap !== undefined) {
    if (typeof readiness.bootstrap !== "object" || readiness.bootstrap === null) throw new Error("Task document readiness.bootstrap must be an object.");
    const candidate = readiness.bootstrap as Record<string, unknown>;
    if (!nonEmptyString(candidate.installCommand) || !nonEmptyString(candidate.checkCommand)) throw new Error("Task document readiness.bootstrap requires non-empty installCommand and checkCommand.");
    bootstrap = { installCommand: candidate.installCommand, checkCommand: candidate.checkCommand };
  }
  return {
    requiredCommands: [...new Set(readiness.requiredCommands)],
    requiredEnvironment: [...new Set(readiness.requiredEnvironment)],
    network: readiness.network as ReadinessRequirements["network"],
    bootstrap
  };
}

export function validateTaskGraph(tasks: TaskDefinition[]): void {
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) throw new Error("Task dependency graph contains duplicate task IDs.");
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    const dependencies = new Set<string>();
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) throw new Error(`Task ${task.id} cannot depend on itself.`);
      if (!byId.has(dependency)) throw new Error(`Task ${task.id} depends on unknown task: ${dependency}.`);
      if (dependencies.has(dependency)) throw new Error(`Task ${task.id} declares duplicate dependency: ${dependency}.`);
      dependencies.add(dependency);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const cycleStart = path.indexOf(id);
      const cycle = [...path.slice(cycleStart), id].join(" -> ");
      throw new Error(`Task dependency cycle detected: ${cycle}.`);
    }
    visiting.add(id);
    path.push(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    path.pop();
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
}

export function validateTaskDocument(value: unknown): TaskDocument {
  if (typeof value !== "object" || value === null) {
    throw new Error("Task document must be a JSON object.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion === 1) {
    throw new Error("Task schemaVersion 1 is no longer supported. Migrate to schemaVersion 2 by adding non-empty verification and dependsOn arrays to every task.");
  }
  if (candidate.schemaVersion !== 2 || !Array.isArray(candidate.tasks) || candidate.tasks.length === 0) {
    throw new Error("Task document requires schemaVersion 2 and a non-empty tasks array.");
  }

  const ids = new Set<string>();
  const tasks = candidate.tasks.map((raw, index): TaskDefinition => {
    if (typeof raw !== "object" || raw === null) {
      throw new Error(`Task ${index + 1} must be an object.`);
    }
    const task = raw as Record<string, unknown>;
    if (!nonEmptyString(task.id) || !nonEmptyString(task.title) || !nonEmptyString(task.objective)) {
      throw new Error(`Task ${index + 1} requires non-empty id, title and objective.`);
    }
    if (ids.has(task.id)) {
      throw new Error(`Duplicate task id: ${task.id}`);
    }
    ids.add(task.id);
    if (!stringList(task.acceptanceCriteria)) {
      throw new Error(`Task ${task.id} acceptanceCriteria must be a non-empty array of non-empty strings.`);
    }
    if (!stringList(task.verification)) {
      throw new Error(`Task ${task.id} verification must be a non-empty array of non-empty strings.`);
    }
    if (!dependencyList(task.dependsOn)) {
      throw new Error(`Task ${task.id} dependsOn must be an array of task IDs (it may be empty).`);
    }
    return {
      id: task.id,
      title: task.title,
      objective: task.objective,
      acceptanceCriteria: task.acceptanceCriteria,
      verification: task.verification,
      dependsOn: task.dependsOn,
      qualityGates: validateQualityGates(task.qualityGates, task.id)
    };
  });
  validateTaskGraph(tasks);
  return { schemaVersion: 2, readiness: validateReadiness(candidate.readiness), tasks };
}

export function loadTaskDocument(file: string): { file: string; document: TaskDocument; hash: string } {
  const resolved = path.resolve(file);
  return { file: resolved, document: validateTaskDocument(readJson<unknown>(resolved)), hash: sha256File(resolved) };
}

export function assertTaskDocumentUnchanged(file: string, expectedHash: string): void {
  if (sha256File(file) !== expectedHash) {
    throw new Error("Task document changed during this run. Requirements are immutable; inspect the diff and start a new run deliberately.");
  }
}
