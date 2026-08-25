import { now } from "./storage";
import { assertTaskStateTransition } from "./state";
import { TaskDefinition, TaskExecution, TaskDocument, WorkflowState } from "./types";

export interface DependencyReadiness {
  ready: boolean;
  unmet: string[];
  blocking: string[];
}

export function automationComplete(execution: TaskExecution | undefined): boolean {
  return execution?.automationStatus === "provisionally_complete" && execution.humanAcceptanceStatus !== "rejected";
}

export function dependencyReadiness(task: TaskDefinition, state: WorkflowState): DependencyReadiness {
  const unmet: string[] = [];
  const blocking: string[] = [];
  for (const dependency of task.dependsOn) {
    const execution = state.tasks[dependency];
    if (automationComplete(execution)) continue;
    unmet.push(dependency);
    if (execution?.automationStatus === "blocked" || execution?.automationStatus === "dependency_blocked" || execution?.automationStatus === "limit_reached" || execution?.humanAcceptanceStatus === "rejected") {
      blocking.push(dependency);
    }
  }
  return { ready: unmet.length === 0, unmet, blocking };
}

export function selectReadyTask(document: TaskDocument, state: WorkflowState): TaskDefinition | undefined {
  return document.tasks.find((task) => {
    const execution = state.tasks[task.id];
    return execution && ["pending", "needs_review", "running"].includes(execution.automationStatus) && dependencyReadiness(task, state).ready;
  });
}

export function transitiveDependants(document: TaskDocument, taskId: string): string[] {
  const affected = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of document.tasks) {
      if (affected.has(task.id)) continue;
      if (task.dependsOn.some((dependency) => dependency === taskId || affected.has(dependency))) {
        affected.add(task.id);
        changed = true;
      }
    }
  }
  return document.tasks.filter((task) => affected.has(task.id)).map((task) => task.id);
}

function transition(execution: TaskExecution, status: "pending" | "dependency_blocked"): void {
  assertTaskStateTransition(execution, { automationStatus: status, humanAcceptanceStatus: execution.humanAcceptanceStatus });
  execution.automationStatus = status;
  execution.lastUpdatedAt = now();
}

export function propagateDependencyBlocks(document: TaskDocument, state: WorkflowState): string[] {
  const changed: string[] = [];
  let changedInPass = true;
  while (changedInPass) {
    changedInPass = false;
    for (const task of document.tasks) {
      const execution = state.tasks[task.id];
      if (!execution) continue;
      const readiness = dependencyReadiness(task, state);
      if (execution.automationStatus === "dependency_blocked" && readiness.blocking.length === 0 && readiness.ready) {
        transition(execution, "pending");
        execution.blockerReason = undefined;
        changed.push(task.id);
        changedInPass = true;
        continue;
      }
      if (execution.automationStatus !== "pending" || readiness.blocking.length === 0) continue;
      transition(execution, "dependency_blocked");
      execution.blockerReason = `Dependency blocked by: ${readiness.blocking.join(", ")}.`;
      changed.push(task.id);
      changedInPass = true;
    }
  }
  return changed;
}

export function formatUnmetDependencies(task: TaskDefinition, state: WorkflowState): string {
  const readiness = dependencyReadiness(task, state);
  if (readiness.ready) return `Task ${task.id} is dependency-ready.`;
  const details = readiness.unmet.map((id) => {
    const execution = state.tasks[id];
    return `${id}=${execution?.automationStatus ?? "missing"}`;
  });
  return `Task ${task.id} is not dependency-ready. Unmet dependencies: ${details.join(", ")}.`;
}
