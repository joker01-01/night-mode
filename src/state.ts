import {
  HumanAcceptanceStatus,
  ProjectStateProposal,
  ProjectStateReview,
  ProjectStateReviewDecision,
  RunStatus,
  TaskAutomationStatus,
  TaskOutcome,
  TaskExecution,
  WorkflowState,
  FailureAttempt
} from "./types";

const automationTransitions: Record<TaskAutomationStatus, readonly TaskAutomationStatus[]> = {
  pending: ["running", "dependency_blocked", "limit_reached"],
  running: ["needs_review", "provisionally_complete", "blocked", "dependency_blocked", "limit_reached"],
  needs_review: ["running", "blocked", "dependency_blocked", "limit_reached"],
  provisionally_complete: ["pending", "dependency_blocked"],
  blocked: ["dependency_blocked", "pending"],
  dependency_blocked: ["pending", "running", "limit_reached"],
  limit_reached: ["pending", "running", "dependency_blocked"]
};

const humanTransitions: Record<HumanAcceptanceStatus, readonly HumanAcceptanceStatus[]> = {
  not_requested: ["awaiting_human_acceptance"],
  awaiting_human_acceptance: ["accepted", "rejected", "not_requested"],
  accepted: ["not_requested"],
  rejected: ["not_requested"]
};

const runTransitions: Record<RunStatus, readonly RunStatus[]> = {
  running: ["completed", "blocked", "stopped", "needs_review", "limit_reached"],
  completed: [],
  blocked: ["running"],
  stopped: ["running"],
  needs_review: ["running", "completed", "blocked", "stopped", "limit_reached"],
  limit_reached: ["running"]
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function stringArrayOrEmpty(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function assertKnownStatus<T extends string>(value: string, values: readonly T[], label: string): asserts value is T {
  if (!values.includes(value as T)) throw new Error(`Unknown ${label}: ${value}`);
}

function validateFailureAttempt(value: unknown): FailureAttempt {
  if (typeof value !== "object" || value === null) throw new Error("Task lastFailure must be an object.");
  const failure = value as Record<string, unknown>;
  if (!nonEmptyString(failure.at) || !nonEmptyString(failure.kind) || !nonEmptyString(failure.detail)) {
    throw new Error("Task lastFailure requires at, kind, and detail.");
  }
  if (!["worker", "validation", "reviewer", "controller"].includes(String(failure.phase))) {
    throw new Error(`Unknown failure phase: ${String(failure.phase)}.`);
  }
  for (const field of ["classification", "primaryCause", "nextAction"]) {
    if (!nonEmptyString(failure[field])) throw new Error(`Task lastFailure requires ${field}.`);
  }
  if (!stringArrayOrEmpty(failure.changedPaths)) throw new Error("Task lastFailure changedPaths must be an array of strings.");
  if (failure.exitCode !== undefined && !Number.isInteger(failure.exitCode)) throw new Error("Task lastFailure exitCode must be an integer.");
  if (failure.timedOut !== undefined && !["idle", "hard"].includes(String(failure.timedOut))) throw new Error("Task lastFailure timedOut must be idle or hard.");
  if (failure.logFile !== undefined && !nonEmptyString(failure.logFile)) throw new Error("Task lastFailure logFile must be non-empty when supplied.");
  return failure as unknown as FailureAttempt;
}

export function assertAutomationStatusTransition(from: TaskAutomationStatus, to: TaskAutomationStatus): void {
  assertKnownStatus(from, Object.keys(automationTransitions) as TaskAutomationStatus[], "automation status");
  assertKnownStatus(to, Object.keys(automationTransitions) as TaskAutomationStatus[], "automation status");
  if (from === to) return;
  if (!automationTransitions[from].includes(to)) {
    throw new Error(`Invalid automation status transition: ${from} -> ${to}.`);
  }
}

export function assertHumanAcceptanceTransition(from: HumanAcceptanceStatus, to: HumanAcceptanceStatus): void {
  assertKnownStatus(from, Object.keys(humanTransitions) as HumanAcceptanceStatus[], "human-acceptance status");
  assertKnownStatus(to, Object.keys(humanTransitions) as HumanAcceptanceStatus[], "human-acceptance status");
  if (from === to) return;
  if (!humanTransitions[from].includes(to)) {
    throw new Error(`Invalid human-acceptance status transition: ${from} -> ${to}.`);
  }
}

export function assertRunStatusTransition(from: RunStatus, to: RunStatus): void {
  assertKnownStatus(from, Object.keys(runTransitions) as RunStatus[], "run status");
  assertKnownStatus(to, Object.keys(runTransitions) as RunStatus[], "run status");
  if (from === to) return;
  if (!runTransitions[from].includes(to)) throw new Error(`Invalid run status transition: ${from} -> ${to}.`);
}

export function assertTaskStateTransition(from: Pick<TaskExecution, "automationStatus" | "humanAcceptanceStatus">, to: Pick<TaskExecution, "automationStatus" | "humanAcceptanceStatus">): void {
  assertAutomationStatusTransition(from.automationStatus, to.automationStatus);
  assertHumanAcceptanceTransition(from.humanAcceptanceStatus, to.humanAcceptanceStatus);

  if (to.automationStatus === "provisionally_complete" && !["awaiting_human_acceptance", "accepted"].includes(to.humanAcceptanceStatus)) {
    throw new Error("A provisionally complete task must await or have received human acceptance.");
  }
  if (["awaiting_human_acceptance", "accepted"].includes(to.humanAcceptanceStatus) && to.automationStatus !== "provisionally_complete") {
    throw new Error("Human acceptance requires a provisionally complete task.");
  }
  if (to.humanAcceptanceStatus === "rejected" && to.automationStatus !== "pending") {
    throw new Error("A rejected task must be reopened to pending before another attempt.");
  }
}

export function taskOutcome(execution: Pick<TaskExecution, "automationStatus" | "humanAcceptanceStatus">): TaskOutcome {
  if (execution.humanAcceptanceStatus === "accepted" && execution.automationStatus === "provisionally_complete") return "completed";
  if (execution.humanAcceptanceStatus === "rejected") return "rejected";
  return execution.automationStatus;
}

export function assertProjectStateProposal(value: unknown): asserts value is ProjectStateProposal {
  if (typeof value !== "object" || value === null) throw new Error("Project-state proposal must be an object.");
  const proposal = value as Record<string, unknown>;
  if (!nonEmptyString(proposal.outcomeSummary)) throw new Error("Project-state proposal requires a non-empty outcomeSummary.");
  for (const field of ["importantDecisions", "knownProblems", "verificationEvidence", "nextActions", "humanAcceptanceActions"]) {
    if (!stringArray(proposal[field])) throw new Error(`Project-state proposal ${field} must be an array of strings.`);
  }
}

export function assertProjectStateReview(value: unknown): asserts value is ProjectStateReview {
  if (typeof value !== "object" || value === null) throw new Error("Project-state review must be an object.");
  const review = value as Record<string, unknown>;
  if (review.decision !== "APPROVE" && review.decision !== "CORRECT") throw new Error("Project-state review decision must be APPROVE or CORRECT.");
  assertProjectStateProposal(review.proposal);
  if (!nonEmptyString(review.feedback)) throw new Error("Project-state review requires non-empty feedback.");
}

export function validateTaskExecution(value: unknown): TaskExecution {
  if (typeof value !== "object" || value === null) throw new Error("Task execution state must be an object.");
  const execution = value as Record<string, unknown>;
  const automationStatus = execution.automationStatus;
  const humanAcceptanceStatus = execution.humanAcceptanceStatus;
  if (typeof automationStatus !== "string" || !Object.prototype.hasOwnProperty.call(automationTransitions, automationStatus)) {
    throw new Error(`Unknown task automation status: ${String(automationStatus)}.`);
  }
  if (typeof humanAcceptanceStatus !== "string" || !Object.prototype.hasOwnProperty.call(humanTransitions, humanAcceptanceStatus)) {
    throw new Error(`Unknown task human-acceptance status: ${String(humanAcceptanceStatus)}.`);
  }
  if (!Number.isSafeInteger(execution.attempts) || Number(execution.attempts) < 0) throw new Error("Task execution attempts must be a non-negative integer.");
  if (!nonEmptyString(execution.lastUpdatedAt)) throw new Error("Task execution requires lastUpdatedAt.");
  if (!Number.isSafeInteger(execution.repeatedOutcomes) || Number(execution.repeatedOutcomes) < 0) throw new Error("Task execution repeatedOutcomes must be a non-negative integer.");
  if (execution.lastFailure !== undefined) validateFailureAttempt(execution.lastFailure);
  if (execution.humanAcceptanceReason !== undefined && !nonEmptyString(execution.humanAcceptanceReason)) throw new Error("Task humanAcceptanceReason must be non-empty when supplied.");
  if (execution.humanAcceptanceAt !== undefined && !nonEmptyString(execution.humanAcceptanceAt)) throw new Error("Task humanAcceptanceAt must be non-empty when supplied.");
  if (execution.checkpoint !== undefined && !nonEmptyString(execution.checkpoint)) throw new Error("Task checkpoint must be non-empty when supplied.");
  if (execution.checkpointError !== undefined && !nonEmptyString(execution.checkpointError)) throw new Error("Task checkpointError must be non-empty when supplied.");
  if (execution.lastPhase !== undefined && !["worker", "validation", "reviewer"].includes(String(execution.lastPhase))) throw new Error("Task lastPhase must be worker, validation, or reviewer.");
  if (execution.lastRerunReason !== undefined && !nonEmptyString(execution.lastRerunReason)) throw new Error("Task lastRerunReason must be non-empty when supplied.");
  assertTaskStateTransition({ automationStatus: automationStatus as TaskAutomationStatus, humanAcceptanceStatus: humanAcceptanceStatus as HumanAcceptanceStatus }, { automationStatus: automationStatus as TaskAutomationStatus, humanAcceptanceStatus: humanAcceptanceStatus as HumanAcceptanceStatus });
  return execution as unknown as TaskExecution;
}

export function validateWorkflowState(value: unknown): WorkflowState {
  if (typeof value !== "object" || value === null) throw new Error("Workflow state must be an object.");
  const state = value as Record<string, unknown>;
  if (state.schemaVersion !== 2) throw new Error("Workflow state requires schemaVersion 2.");
  if (typeof state.mode !== "string" || !["interactive", "night"].includes(state.mode)) throw new Error(`Unknown workflow mode: ${String(state.mode)}.`);
  if (typeof state.status !== "string" || !Object.prototype.hasOwnProperty.call(runTransitions, state.status)) throw new Error(`Unknown workflow run status: ${String(state.status)}.`);
  if (typeof state.runId !== "string" || !nonEmptyString(state.runId)) throw new Error("Workflow state requires runId.");
  if (typeof state.taskSourceFile !== "string" || !nonEmptyString(state.taskSourceFile)) throw new Error("Workflow state requires taskSourceFile.");
  if (typeof state.taskSourceHash !== "string" || !/^[a-f0-9]{64}$/i.test(state.taskSourceHash)) throw new Error("Workflow state requires a SHA-256 taskSourceHash.");
  if (!nonEmptyString(state.startedAt) || !nonEmptyString(state.updatedAt)) throw new Error("Workflow state requires startedAt and updatedAt.");
  if (typeof state.initialGitClean !== "boolean" && state.initialGitClean !== null) throw new Error("Workflow state requires initialGitClean.");
  if (typeof state.gitBaseline !== "object" || state.gitBaseline === null) throw new Error("Workflow state requires a Git baseline.");
  const baseline = state.gitBaseline as Record<string, unknown>;
  if (baseline.initialCommit !== null && !nonEmptyString(baseline.initialCommit)) throw new Error("Git baseline initialCommit must be a string or null.");
  if (!stringArrayOrEmpty(baseline.initialStatus) || !stringArrayOrEmpty(baseline.initialChangedPaths)) throw new Error("Git baseline status fields must be arrays of strings.");
  if (typeof baseline.representationHash !== "string" || !/^[a-f0-9]{64}$/i.test(baseline.representationHash)) throw new Error("Git baseline requires a SHA-256 representationHash.");
  if (!stringArrayOrEmpty(state.preflightWarnings)) throw new Error("Workflow state preflightWarnings must be an array of strings.");
  if (typeof state.checkpointAllowed !== "boolean") throw new Error("Workflow state requires checkpointAllowed.");
  if (state.targetCwd !== undefined && !nonEmptyString(state.targetCwd)) throw new Error("Workflow state targetCwd must be non-empty when supplied.");
  if (state.budgetStartedAt !== undefined && !nonEmptyString(state.budgetStartedAt)) throw new Error("Workflow state budgetStartedAt must be non-empty when supplied.");
  if (state.tasksProcessed !== undefined && (!Number.isSafeInteger(state.tasksProcessed) || Number(state.tasksProcessed) < 0)) throw new Error("Workflow state tasksProcessed must be a non-negative integer.");
  if (state.limits !== undefined) {
    if (typeof state.limits !== "object" || state.limits === null) throw new Error("Workflow state limits must be an object.");
    const limits = state.limits as Record<string, unknown>;
    for (const field of ["totalRuntimeSeconds", "maxTasks", "maxAttempts"]) {
      if (!Number.isSafeInteger(limits[field]) || Number(limits[field]) < 0) throw new Error(`Workflow state limit ${field} must be a non-negative integer.`);
    }
    if (Number(limits.maxAttempts) < 1) throw new Error("Workflow state limit maxAttempts must be positive.");
  }
  if (state.approvedProjectState !== undefined) assertProjectStateProposal(state.approvedProjectState);
  if (state.projectStateReviewDecision !== undefined && !["APPROVE", "CORRECT"].includes(String(state.projectStateReviewDecision))) {
    throw new Error("Workflow state projectStateReviewDecision must be APPROVE or CORRECT.");
  }
  if (typeof state.tasks !== "object" || state.tasks === null || Array.isArray(state.tasks)) throw new Error("Workflow state requires a task map.");
  for (const execution of Object.values(state.tasks as Record<string, unknown>)) validateTaskExecution(execution);
  return state as unknown as WorkflowState;
}
