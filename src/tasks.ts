import { TaskDefinition, TaskDocument } from "./types";
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
      dependsOn: task.dependsOn
    };
  });
  validateTaskGraph(tasks);
  return { schemaVersion: 2, tasks };
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
