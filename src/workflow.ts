import {
  FailureAttempt, FailureMemory, FailurePhase, Mode, ReviewResult, RunLimits, RunOptions, TaskDefinition, TaskExecution,
  TaskAutomationStatus, ValidationResult, WorkflowPaths, WorkflowState, WorkResult
} from "./types";
import { appendEvent, fileExists, now, readJson, sha256Text, workflowPaths, writeJsonAtomic } from "./storage";
import { assertTaskDocumentUnchanged, loadTaskDocument } from "./tasks";
import { acquireLock, releaseLock } from "./lock";
import { parseReviewResult, parseWorkResult, runCodexPhase, writeSchemas } from "./codex";
import { runValidation } from "./validation";
import { createCheckpoint, gitSnapshot, preflightGit } from "./git";
import { writeHandoff } from "./report";
import { updateManagedProjectState } from "./project-state";
import { assertTaskStateTransition, validateWorkflowState } from "./state";
import { dependencyReadiness, formatUnmetDependencies, propagateDependencyBlocks, selectReadyTask, transitiveDependants } from "./scheduler";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TOTAL_RUNTIME_SECONDS = 8 * 60 * 60;
const DEFAULT_NIGHT_MAX_TASKS = 10;

function runId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(16).slice(2, 8)}`;
}

function initialTaskExecution(): TaskExecution {
  return { automationStatus: "pending", humanAcceptanceStatus: "not_requested", attempts: 0, lastUpdatedAt: now(), repeatedOutcomes: 0 };
}

function loadFailureMemory(paths: WorkflowPaths): FailureMemory {
  if (!fileExists(paths.failureFile)) return { schemaVersion: 1, tasks: {} };
  return readJson<FailureMemory>(paths.failureFile);
}

function saveState(paths: WorkflowPaths, state: WorkflowState): void {
  state.updatedAt = now();
  writeJsonAtomic(paths.stateFile, state);
}

function syncProjectState(paths: WorkflowPaths, state: WorkflowState): void {
  updateManagedProjectState(paths.projectStateFile, state);
}

function recordFailure(paths: WorkflowPaths, taskId: string, failure: FailureAttempt): FailureMemory {
  const memory = loadFailureMemory(paths);
  const record = memory.tasks[taskId] ?? { attempts: [], diversityRequired: false };
  const previous = record.attempts.at(-1);
  if (previous && (previous.classification ?? previous.kind) === failure.classification && (previous.primaryCause ?? previous.detail) === failure.primaryCause) {
    record.diversityRequired = true;
  }
  if (failure.classification === "stagnant_outcome") record.diversityRequired = true;
  record.attempts.push(failure);
  memory.tasks[taskId] = record;
  writeJsonAtomic(paths.failureFile, memory);
  appendEvent(paths.eventsFile, "failure_recorded", {
    taskId,
    phase: failure.phase,
    classification: failure.classification,
    primaryCause: failure.primaryCause,
    logFile: failure.logFile ?? null,
    nextAction: failure.nextAction
  });
  return memory;
}

function failureContext(memory: FailureMemory, taskId: string): string {
  const record = memory.tasks[taskId];
  if (!record?.attempts.length) return "No previous failed attempts are recorded.";
  const history = record.attempts.slice(-3).map((attempt) => {
    const classification = attempt.classification ?? attempt.kind;
    const cause = attempt.primaryCause ?? attempt.detail;
    const log = attempt.logFile ? `; log: ${attempt.logFile}` : "";
    return `- ${attempt.at} [${attempt.phase ?? "unknown"}/${classification}] ${cause}${log}; next action: ${attempt.nextAction ?? "Review the failure evidence before retrying."}`;
  }).join("\n");
  return `${record.diversityRequired ? "A repeated approach failed. Use a materially different approach.\n" : ""}${history}`;
}

export function completionGateSatisfied(work: WorkResult, review: ReviewResult, validation: ValidationResult): boolean {
  return work.status === "COMPLETE"
    && review.decision === "SHIP"
    && validation.status === "passed"
    && work.projectStateProposal !== undefined
    && review.projectStateReview !== undefined;
}

function makeFailureEvidence(input: {
  phase: FailurePhase;
  classification: string;
  primaryCause: string;
  nextAction: string;
  changedPaths: string[];
  exitCode?: number;
  timedOut?: "idle" | "hard";
  logFile?: string;
  workerAssessment?: string;
  reviewerFeedback?: string;
  verification?: ValidationResult;
}): FailureAttempt {
  return {
    at: now(),
    kind: input.classification,
    detail: input.primaryCause,
    phase: input.phase,
    classification: input.classification,
    primaryCause: input.primaryCause,
    nextAction: input.nextAction,
    changedPaths: input.changedPaths,
    exitCode: input.exitCode,
    timedOut: input.timedOut,
    logFile: input.logFile,
    workerAssessment: input.workerAssessment,
    reviewerFeedback: input.reviewerFeedback,
    verification: input.verification
  };
}

function validationFailureEvidence(validation: ValidationResult, changedPaths: string[], workerAssessment?: string, reviewerFeedback?: string): FailureAttempt {
  const failed = validation.commands.find((command) => command.exitCode !== 0 || command.timedOut);
  const outcome = failed?.timedOut ? `${failed.timedOut} timeout` : `exit code ${failed?.exitCode ?? "unknown"}`;
  const command = failed?.command ?? "verification command";
  const logFile = failed?.outputFile;
  return makeFailureEvidence({
    phase: "validation",
    classification: "validation_failed",
    primaryCause: `Declared verification failed: ${command} (${outcome}).${logFile ? ` Log: ${logFile}` : ""}`,
    nextAction: `Fix the declared verification failure and rerun ${command}.`,
    changedPaths,
    exitCode: failed?.exitCode,
    timedOut: failed?.timedOut,
    logFile,
    workerAssessment,
    reviewerFeedback,
    verification: validation
  });
}

function criteria(task: TaskDefinition): string {
  return task.acceptanceCriteria.map((item) => `- ${item}`).join("\n");
}

function buildWorkerPrompt(task: TaskDefinition, failure: string, priorFeedback?: string): string {
  return `You are the worker in a repository-local Codex workflow. Start with fresh context and work only on this task.\n\nTask ID: ${task.id}\nTitle: ${task.title}\nObjective:\n${task.objective}\n\nAcceptance criteria:\n${criteria(task)}\n\nPrior reviewer feedback:\n${priorFeedback ?? "None."}\n\nFailure memory:\n${failure}\n\nSafety rules:\n- Do not modify the task document; it is immutable for this run.\n- Do not run destructive Git commands, change Git history, or bypass approvals/sandbox.\n- Make the smallest effective change and gather concrete evidence.\n- Run only task-relevant checks. The controller will run declared verification commands separately.\n\nReturn exactly one JSON object matching the supplied schema. Use BLOCKED only for a genuine external blocker and include blockerReason; otherwise return blockerReason as an empty string.`;
}

function buildReviewerPrompt(task: TaskDefinition, work: WorkResult, validation: ValidationResult): string {
  const commandEvidence = validation.commands.length
    ? validation.commands.map((command) => `- ${command.command}: exit ${command.exitCode}${command.timedOut ? ` (${command.timedOut} timeout)` : ""}; log ${command.outputFile}`).join("\n")
    : "- No verification command was configured.";
  return `You are the independent reviewer in a Codex workflow. Start with fresh context. Inspect the repository and judge this one task against its objective and acceptance criteria. You are read-only: do not edit files.\n\nTask ID: ${task.id}\nTitle: ${task.title}\nObjective:\n${task.objective}\n\nAcceptance criteria:\n${criteria(task)}\n\nWorker result:\n${JSON.stringify(work, null, 2)}\n\nController-run verification:\n- Overall: ${validation.status}\n${commandEvidence}\n\nReview rules:\n- SHIP only when the worker reported COMPLETE, the acceptance criteria are actually met, and configured verification did not fail.\n- If the worker reports BLOCKED, return BLOCKED only for a genuine external blocker; otherwise REVISE with a concrete next step.\n- Do not accept completion based solely on the worker claim.\n\nReturn exactly one JSON object matching the supplied schema.`;
}

function normalizeRunOptions(options: RunOptions): RunOptions {
  const totalRuntimeSeconds = options.totalRuntimeSeconds ?? DEFAULT_TOTAL_RUNTIME_SECONDS;
  const maxTasks = options.maxTasks ?? (options.mode === "night" ? DEFAULT_NIGHT_MAX_TASKS : 0);
  if (!Number.isSafeInteger(totalRuntimeSeconds) || totalRuntimeSeconds < 0) throw new Error("totalRuntimeSeconds must be a non-negative integer.");
  if (!Number.isSafeInteger(maxTasks) || maxTasks < 0 || (options.mode === "night" && maxTasks === 0)) throw new Error("Night Shift requires a positive maxTasks limit.");
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1) throw new Error("maxAttempts must be a positive integer.");
  return { ...options, totalRuntimeSeconds, maxTasks };
}

function runLimits(options: RunOptions): RunLimits {
  return { totalRuntimeSeconds: options.totalRuntimeSeconds, maxTasks: options.maxTasks, maxAttempts: options.maxAttempts };
}

function runtimeExceeded(state: WorkflowState, options: RunOptions): boolean {
  const startedAt = Date.parse(state.budgetStartedAt ?? state.startedAt);
  return Number.isFinite(startedAt) && Date.now() - startedAt >= options.totalRuntimeSeconds * 1_000;
}

type BoundaryReason = "stop_file_detected" | "total_runtime_reached";

function boundaryReason(paths: WorkflowPaths, state: WorkflowState, options: RunOptions): BoundaryReason | undefined {
  if (fileExists(paths.stopFile)) return "stop_file_detected";
  if (runtimeExceeded(state, options)) return "total_runtime_reached";
  return undefined;
}

async function waitForPause(paths: WorkflowPaths, state: WorkflowState, options: RunOptions): Promise<BoundaryReason | undefined> {
  while (fileExists(paths.pauseFile)) {
    const reason = boundaryReason(paths, state, options);
    if (reason) return reason;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return boundaryReason(paths, state, options);
}

function applyBoundary(paths: WorkflowPaths, state: WorkflowState, task: TaskDefinition | undefined, reason: BoundaryReason): void {
  const execution = task ? state.tasks[task.id] : undefined;
  if (reason === "stop_file_detected") {
    if (execution?.automationStatus === "running") {
      mark(execution, "needs_review");
      execution.lastRerunReason = reason;
    }
    state.status = "stopped";
    state.stopReason = reason;
    appendEvent(paths.eventsFile, "run_stopped", { reason, taskId: task?.id ?? null });
  } else {
    if (execution?.automationStatus === "running") {
      mark(execution, "limit_reached");
      execution.blockerReason = undefined;
      execution.lastAssessment = "The total runtime limit was reached before this task completed.";
      execution.lastFeedback = execution.lastAssessment;
      execution.lastRerunReason = reason;
      appendEvent(paths.eventsFile, "task_limit_reached", { taskId: task!.id, limit: reason });
    }
    state.status = "limit_reached";
    state.stopReason = reason;
    appendEvent(paths.eventsFile, "run_limit_reached", { reason, taskId: task?.id ?? null });
  }
  saveState(paths, state);
}

function mark(execution: TaskExecution, status: TaskAutomationStatus): void {
  const humanAcceptanceStatus = status === "provisionally_complete"
    ? "awaiting_human_acceptance"
    : execution.humanAcceptanceStatus === "rejected" && status === "running"
      ? "not_requested"
      : execution.humanAcceptanceStatus;
  assertTaskStateTransition(execution, { automationStatus: status, humanAcceptanceStatus });
  execution.automationStatus = status;
  execution.humanAcceptanceStatus = humanAcceptanceStatus;
  execution.lastUpdatedAt = now();
}

type PhaseResult = Awaited<ReturnType<typeof runCodexPhase>>;

class PhaseFailureError extends Error {
  constructor(
    public readonly phase: "worker" | "reviewer",
    public readonly result: PhaseResult,
    public readonly globalBlocker: boolean,
    message: string
  ) {
    super(message);
    this.name = "PhaseFailureError";
  }
}

function phaseFailure(phase: "worker" | "reviewer", result: PhaseResult): PhaseFailureError {
  const cause = result.error ?? (result.timedOut ? `${result.timedOut} timeout` : `process exited with code ${result.commandExit}`);
  const message = `${phase[0].toUpperCase()}${phase.slice(1)} phase failed: ${cause}. Log: ${result.logFile}`;
  return new PhaseFailureError(phase, result, Boolean(result.error), message);
}

function applyFailure(paths: WorkflowPaths, state: WorkflowState, task: TaskDefinition, status: "needs_review" | "blocked", failure: FailureAttempt): void {
  const execution = state.tasks[task.id];
  mark(execution, status);
  execution.lastFailure = failure;
  execution.lastAssessment = failure.primaryCause;
  execution.lastFeedback = failure.primaryCause;
  execution.changedPaths = failure.changedPaths;
  recordFailure(paths, task.id, failure);
  saveState(paths, state);
  syncProjectState(paths, state);
}

function workflowChangedPaths(paths: WorkflowPaths, state: WorkflowState): string[] {
  const baseline = new Set(state.gitBaseline.initialChangedPaths);
  return gitSnapshot(paths.cwd, paths.stateDir).changedPaths.filter((changedPath) => !baseline.has(changedPath));
}

async function runTask(paths: WorkflowPaths, state: WorkflowState, task: TaskDefinition, options: RunOptions, sourceHash: string): Promise<void> {
  const execution = state.tasks[task.id];
  if (execution.lastRerunReason) {
    appendEvent(paths.eventsFile, "phase_rerun", {
      taskId: task.id,
      attempt: execution.attempts + 1,
      previousPhase: execution.lastPhase ?? null,
      reason: execution.lastRerunReason
    });
  }
  mark(execution, "running");
  saveState(paths, state);
  let priorFeedback = execution.lastFeedback;

  while (execution.attempts < options.maxAttempts) {
    const initialBoundary = await waitForPause(paths, state, options);
    if (initialBoundary) {
      applyBoundary(paths, state, task, initialBoundary);
      return;
    }
    execution.attempts += 1;
    execution.lastUpdatedAt = now();
    saveState(paths, state);
    const attempt = execution.attempts;
    appendEvent(paths.eventsFile, "task_attempt_started", { taskId: task.id, attempt });

    let activePhase: FailurePhase = "controller";
    let workerPhase: PhaseResult | undefined;
    let reviewerPhase: PhaseResult | undefined;
    let work: WorkResult | undefined;
    let validation: ValidationResult | undefined;
    let review: ReviewResult | undefined;

    try {
      assertTaskDocumentUnchanged(options.taskFile, sourceHash);
      const memory = loadFailureMemory(paths);
      activePhase = "worker";
      workerPhase = await runCodexPhase({ paths, codexBin: options.codexBin, phase: "work", taskId: task.id, attempt, prompt: buildWorkerPrompt(task, failureContext(memory, task.id), priorFeedback), idleTimeoutSeconds: options.idleTimeoutSeconds, hardTimeoutSeconds: options.hardTimeoutSeconds });
      assertTaskDocumentUnchanged(options.taskFile, sourceHash);
      if (workerPhase.commandExit !== 0) throw phaseFailure("worker", workerPhase);
      work = parseWorkResult(workerPhase.resultFile);
      execution.lastPhase = "worker";
      saveState(paths, state);
      const workerBoundary = await waitForPause(paths, state, options);
      if (workerBoundary) {
        applyBoundary(paths, state, task, workerBoundary);
        return;
      }
      activePhase = "validation";
      validation = await runValidation(paths, task, attempt, options.hardTimeoutSeconds);
      execution.validation = validation;
      execution.lastPhase = "validation";
      saveState(paths, state);
      const validationBoundary = await waitForPause(paths, state, options);
      if (validationBoundary) {
        applyBoundary(paths, state, task, validationBoundary);
        return;
      }
      activePhase = "reviewer";
      reviewerPhase = await runCodexPhase({ paths, codexBin: options.codexBin, phase: "review", taskId: task.id, attempt, prompt: buildReviewerPrompt(task, work, validation), idleTimeoutSeconds: options.idleTimeoutSeconds, hardTimeoutSeconds: options.hardTimeoutSeconds });
      assertTaskDocumentUnchanged(options.taskFile, sourceHash);
      if (reviewerPhase.commandExit !== 0) throw phaseFailure("reviewer", reviewerPhase);
      review = parseReviewResult(reviewerPhase.resultFile);
      execution.lastPhase = "reviewer";
      saveState(paths, state);
      const reviewerBoundary = await waitForPause(paths, state, options);
      if (reviewerBoundary) {
        applyBoundary(paths, state, task, reviewerBoundary);
        return;
      }
      activePhase = "controller";
      execution.lastDecision = review.decision;
      execution.lastAssessment = review.assessment;
      execution.lastFeedback = review.feedback;
      execution.changedPaths = workflowChangedPaths(paths, state);
      const outcomeHash = sha256Text(JSON.stringify({ work, review, validation: validation.status }));
      execution.repeatedOutcomes = execution.lastOutcomeHash === outcomeHash ? execution.repeatedOutcomes + 1 : 0;
      execution.lastOutcomeHash = outcomeHash;

      if (execution.repeatedOutcomes >= options.maxStagnantAttempts) {
        const failure = makeFailureEvidence({
          phase: "controller",
          classification: "stagnant_outcome",
          primaryCause: "Repeated worker/reviewer outcome exceeded the configured stall threshold.",
          nextAction: "Review the recorded failure memory and use a materially different approach before resuming.",
          changedPaths: execution.changedPaths ?? [],
          workerAssessment: work.assessment,
          reviewerFeedback: review.feedback,
          verification: validation
        });
        execution.blockerReason = failure.primaryCause;
        applyFailure(paths, state, task, "blocked", failure);
        return;
      }
      if (completionGateSatisfied(work, review, validation)) {
        assertTaskDocumentUnchanged(options.taskFile, sourceHash);
        state.approvedProjectState = review.projectStateReview!.proposal;
        state.projectStateReviewDecision = review.projectStateReview!.decision;
        execution.checkpointError = undefined;
        mark(execution, "provisionally_complete");
        appendEvent(paths.eventsFile, "task_provisionally_completed", { taskId: task.id, attempt, checkpoint: null });
        saveState(paths, state);
        syncProjectState(paths, state);
        if (options.checkpoint) {
          try {
            if (state.initialGitClean !== true) throw new Error("Git checkpoint is enabled, but the worktree was not clean at run start.");
            execution.checkpoint = createCheckpoint(paths.cwd, `workflow: ${task.id} ${task.title}`, paths.stateDir, execution.changedPaths ?? workflowChangedPaths(paths, state));
            appendEvent(paths.eventsFile, "checkpoint_created", { taskId: task.id, checkpoint: execution.checkpoint ?? null });
          } catch (error) {
            execution.checkpointError = error instanceof Error ? error.message : String(error);
            state.status = "needs_review";
            state.stopReason = "checkpoint_failed";
            appendEvent(paths.eventsFile, "checkpoint_failed", { taskId: task.id, reason: execution.checkpointError });
            saveState(paths, state);
            syncProjectState(paths, state);
            return;
          }
        }
        saveState(paths, state);
        syncProjectState(paths, state);
        return;
      }
      if (review.decision === "BLOCKED") {
        const failure = makeFailureEvidence({
          phase: "reviewer",
          classification: "reviewer_blocked",
          primaryCause: review.feedback,
          nextAction: "Resolve the reviewer-identified blocker, then resume the task.",
          changedPaths: execution.changedPaths ?? [],
          logFile: reviewerPhase.logFile,
          workerAssessment: work.assessment,
          reviewerFeedback: review.feedback,
          verification: validation
        });
        execution.blockerReason = work.blockerReason ?? review.feedback;
        applyFailure(paths, state, task, "blocked", failure);
        return;
      }
      priorFeedback = review.feedback;
      const failure = validation.status !== "passed"
        ? validationFailureEvidence(validation, execution.changedPaths ?? [], work.assessment, review.feedback)
        : makeFailureEvidence({
          phase: "reviewer",
          classification: review.decision === "REVISE" ? "review_revise" : "worker_incomplete",
          primaryCause: review.decision === "REVISE" ? review.feedback : "The worker did not return COMPLETE, so the completion gate cannot pass.",
          nextAction: review.decision === "REVISE" ? "Address the reviewer feedback and retry with a materially different approach if the outcome repeats." : "Complete the task and return a schema-valid COMPLETE result.",
          changedPaths: execution.changedPaths ?? [],
          logFile: reviewerPhase.logFile,
          workerAssessment: work.assessment,
          reviewerFeedback: review.feedback,
          verification: validation
        });
      applyFailure(paths, state, task, "needs_review", failure);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (detail.startsWith("Task document changed during this run.")) {
        const failure = makeFailureEvidence({
          phase: "controller",
          classification: "task_source_mutated",
          primaryCause: detail,
          nextAction: "Inspect the task document diff and start a new run deliberately.",
          changedPaths: workflowChangedPaths(paths, state)
        });
        execution.blockerReason = detail;
        state.status = "blocked";
        state.stopReason = "task_source_mutated";
        applyFailure(paths, state, task, "blocked", failure);
        return;
      }
      if (error instanceof PhaseFailureError && error.globalBlocker) {
        const failure = makeFailureEvidence({
          phase: error.phase,
          classification: "global_blocker",
          primaryCause: detail,
          nextAction: "Restore the Codex runtime or required external capability, then resume after inspection.",
          changedPaths: workflowChangedPaths(paths, state),
          exitCode: error.result.commandExit,
          timedOut: error.result.timedOut,
          logFile: error.result.logFile
        });
        execution.blockerReason = detail;
        state.status = "blocked";
        state.stopReason = "global_blocker";
        applyFailure(paths, state, task, "blocked", failure);
        return;
      }
      if (error instanceof PhaseFailureError) {
        const failure = makeFailureEvidence({
          phase: error.phase,
          classification: error.result.timedOut ? "phase_timeout" : "phase_failure",
          primaryCause: detail,
          nextAction: `Inspect the ${error.phase} phase evidence and retry after addressing the cause.`,
          changedPaths: workflowChangedPaths(paths, state),
          exitCode: error.result.commandExit,
          timedOut: error.result.timedOut,
          logFile: error.result.logFile
        });
        applyFailure(paths, state, task, "needs_review", failure);
        continue;
      }
      const phaseLog = activePhase === "worker" ? workerPhase?.logFile : activePhase === "reviewer" ? reviewerPhase?.logFile : undefined;
      const failure = makeFailureEvidence({
        phase: activePhase,
        classification: activePhase === "worker" || activePhase === "reviewer" ? "malformed_output" : "controller_error",
        primaryCause: `${detail}${phaseLog ? ` Log: ${phaseLog}` : ""}`,
        nextAction: activePhase === "worker" || activePhase === "reviewer" ? "Inspect the phase output and return a schema-valid result before retrying." : "Inspect the controller error and retry only after the cause is understood.",
        changedPaths: workflowChangedPaths(paths, state),
        logFile: phaseLog,
        workerAssessment: work?.assessment,
        reviewerFeedback: review?.feedback,
        verification: validation
      });
      applyFailure(paths, state, task, "needs_review", failure);
    }
  }
  mark(execution, "limit_reached");
  execution.blockerReason = undefined;
  execution.lastAssessment = `Attempt limit (${options.maxAttempts}) reached without an accepted review.`;
  execution.lastFeedback = `${execution.lastAssessment}${execution.lastFeedback ? ` Last failure: ${execution.lastFeedback}` : ""}`;
  execution.lastRerunReason = "task_attempt_limit_reached";
  appendEvent(paths.eventsFile, "task_limit_reached", { taskId: task.id, limit: "max_attempts", maxAttempts: options.maxAttempts });
  saveState(paths, state);
}

function refreshDependencyStatuses(paths: WorkflowPaths, state: WorkflowState, document: ReturnType<typeof loadTaskDocument>["document"]): void {
  const changed = propagateDependencyBlocks(document, state);
  for (const taskId of changed) {
    appendEvent(paths.eventsFile, "dependency_status_changed", {
      taskId,
      status: state.tasks[taskId].automationStatus,
      blockerReason: state.tasks[taskId].blockerReason ?? null
    });
  }
}

function initializeState(paths: WorkflowPaths, options: RunOptions, taskSourceFile: string, taskSourceHash: string, tasks: TaskDefinition[], preflight: ReturnType<typeof preflightGit>): WorkflowState {
  return {
    schemaVersion: 2,
    runId: runId(),
    mode: options.mode,
    status: "running",
    taskSourceFile,
    taskSourceHash,
    startedAt: now(),
    updatedAt: now(),
    targetCwd: paths.cwd,
    budgetStartedAt: now(),
    tasksProcessed: 0,
    limits: runLimits(options),
    initialGitClean: preflight.clean,
    gitBaseline: preflight.baseline,
    preflightWarnings: preflight.warnings,
    checkpointAllowed: preflight.checkpointAllowed,
    tasks: Object.fromEntries(tasks.map((task) => [task.id, initialTaskExecution()]))
  };
}

function prepareResume(paths: WorkflowPaths, state: WorkflowState, options: RunOptions): void {
  const previousStatus = state.status;
  if (previousStatus === "completed") throw new Error("Cannot resume a completed workflow.");
  state.status = "running";
  state.stopReason = undefined;
  state.budgetStartedAt = now();
  state.tasksProcessed = 0;
  state.limits = runLimits(options);

  for (const [taskId, execution] of Object.entries(state.tasks)) {
    if (execution.automationStatus === "running") {
      execution.lastRerunReason = `resume_after_${previousStatus === "running" ? "process_interruption" : previousStatus}`;
      appendEvent(paths.eventsFile, "phase_rerun_scheduled", {
        taskId,
        previousPhase: execution.lastPhase ?? null,
        reason: execution.lastRerunReason
      });
      continue;
    }
    if (execution.automationStatus === "limit_reached") {
      assertTaskStateTransition(execution, { automationStatus: "pending", humanAcceptanceStatus: execution.humanAcceptanceStatus });
      execution.automationStatus = "pending";
      execution.blockerReason = undefined;
      execution.lastUpdatedAt = now();
      execution.lastRerunReason = `resume_after_${previousStatus}`;
      appendEvent(paths.eventsFile, "task_limit_reopened", { taskId, reason: execution.lastRerunReason });
      continue;
    }
    if (previousStatus === "blocked" && execution.automationStatus === "blocked") {
      assertTaskStateTransition(execution, { automationStatus: "pending", humanAcceptanceStatus: execution.humanAcceptanceStatus });
      execution.automationStatus = "pending";
      execution.blockerReason = undefined;
      execution.lastUpdatedAt = now();
      execution.lastRerunReason = "resume_after_global_blocker";
      appendEvent(paths.eventsFile, "blocked_task_reopened", { taskId, reason: execution.lastRerunReason });
    }
  }
  saveState(paths, state);
}

function hasOpenWork(state: WorkflowState): boolean {
  return Object.values(state.tasks).some((task) => ["blocked", "dependency_blocked", "needs_review", "running", "limit_reached"].includes(task.automationStatus))
    || Object.values(state.tasks).some((task) => task.humanAcceptanceStatus === "awaiting_human_acceptance");
}

function finalizeRunStatus(state: WorkflowState): void {
  if (state.status !== "running") return;
  const awaitingAcceptance = Object.values(state.tasks).some((task) => task.humanAcceptanceStatus === "awaiting_human_acceptance");
  const taskLimitReached = Object.values(state.tasks).some((task) => task.automationStatus === "limit_reached");
  if (taskLimitReached) {
    state.status = "limit_reached";
    state.stopReason ??= "task_attempt_limit_reached";
  } else if (hasOpenWork(state) || awaitingAcceptance) {
    state.status = "needs_review";
    state.stopReason ??= awaitingAcceptance ? "awaiting_human_acceptance" : "no_actionable_tasks";
  } else {
    state.status = "completed";
    state.stopReason ??= "no_actionable_tasks";
  }
}

export async function runWorkflow(options: RunOptions): Promise<WorkflowState> {
  const executionOptions = normalizeRunOptions(options);
  const paths = workflowPaths(executionOptions.cwd, executionOptions.stateDir);
  const loaded = loadTaskDocument(executionOptions.taskFile);
  const preflight = executionOptions.resume ? undefined : preflightGit(executionOptions.cwd, executionOptions.mode, executionOptions.allowDirty, paths.stateDir);
  let state: WorkflowState;
  if (executionOptions.resume) {
    if (!fileExists(paths.stateFile)) throw new Error(`Cannot resume: missing state file at ${paths.stateFile}`);
    state = validateWorkflowState(readJson<unknown>(paths.stateFile));
    if (state.targetCwd && path.resolve(state.targetCwd) !== paths.cwd) throw new Error(`Cannot resume: target repository differs from the saved run (${state.targetCwd}).`);
    const repository = gitSnapshot(executionOptions.cwd, paths.stateDir);
    if (!repository.available) throw new Error(`Git preflight failed while resuming: ${repository.error ?? "target is not a Git working tree"}.`);
    if (state.taskSourceFile !== loaded.file || state.taskSourceHash !== loaded.hash) throw new Error("Cannot resume: the task source differs from the saved run. Start a new run after reviewing the change.");
    state.mode = executionOptions.mode;
    state.targetCwd = paths.cwd;
  } else {
    if (fileExists(paths.stateFile)) throw new Error(`A prior run state exists at ${paths.stateFile}. Use resume or archive it deliberately before starting a new run.`);
    state = initializeState(paths, executionOptions, loaded.file, loaded.hash, loaded.document.tasks, preflight!);
  }
  const boundedOptions: RunOptions = { ...executionOptions, checkpoint: executionOptions.checkpoint && state.checkpointAllowed };
  writeSchemas(paths);
  acquireLock(paths, boundedOptions.reclaimStaleLock, { runId: state.runId, target: paths.cwd, commandContext: process.argv.join(" ") });
  if (boundedOptions.resume) prepareResume(paths, state, boundedOptions);
  else saveState(paths, state);
  appendEvent(paths.eventsFile, boundedOptions.resume ? "run_resumed" : "run_started", { runId: state.runId, mode: state.mode, taskFile: loaded.file });
  for (const warning of state.preflightWarnings) appendEvent(paths.eventsFile, "preflight_warning", { warning });

  try {
    while (true) {
      const boundary = await waitForPause(paths, state, boundedOptions);
      if (boundary) {
        applyBoundary(paths, state, undefined, boundary);
        break;
      }
      refreshDependencyStatuses(paths, state, loaded.document);
      if (boundedOptions.mode === "night" && (state.tasksProcessed ?? 0) >= boundedOptions.maxTasks && selectReadyTask(loaded.document, state)) {
        state.status = "limit_reached";
        state.stopReason = "max_tasks_reached";
        appendEvent(paths.eventsFile, "run_limit_reached", { reason: state.stopReason, tasksProcessed: state.tasksProcessed });
        break;
      }
      let task: TaskDefinition | undefined;
      if (boundedOptions.mode === "interactive") {
        if (!boundedOptions.taskId) throw new Error("Interactive mode requires --task <id>.");
        task = loaded.document.tasks.find((item) => item.id === boundedOptions.taskId);
        if (!task) throw new Error(`Task not found: ${boundedOptions.taskId}`);
        if (state.tasks[task.id].automationStatus === "provisionally_complete") throw new Error(`Task ${task.id} is already provisionally complete in this run and awaits human acceptance.`);
        if (!dependencyReadiness(task, state).ready) {
          state.tasks[task.id].lastFeedback = formatUnmetDependencies(task, state);
          state.tasks[task.id].lastUpdatedAt = now();
          state.status = "needs_review";
          state.stopReason = "interactive_dependencies_unmet";
          break;
        }
      } else {
        task = selectReadyTask(loaded.document, state);
      }
      if (!task) {
        const awaitingAcceptance = Object.values(state.tasks).some((execution) => execution.humanAcceptanceStatus === "awaiting_human_acceptance");
        const taskLimitReached = Object.values(state.tasks).some((execution) => execution.automationStatus === "limit_reached");
        state.stopReason = awaitingAcceptance ? "awaiting_human_acceptance" : taskLimitReached ? "task_attempt_limit_reached" : "no_actionable_tasks";
        break;
      }
      await runTask(paths, state, task, boundedOptions, loaded.hash);
      state.tasksProcessed = (state.tasksProcessed ?? 0) + 1;
      saveState(paths, state);
      if (state.status === "stopped" || state.status === "blocked" || state.status === "limit_reached" || state.stopReason === "checkpoint_failed" || boundedOptions.mode === "interactive") break;
    }
    finalizeRunStatus(state);
    saveState(paths, state);
    syncProjectState(paths, state);
    appendEvent(paths.eventsFile, "run_finished", { runId: state.runId, status: state.status, stopReason: state.stopReason ?? null });
    writeHandoff(paths, state, loaded.document);
    return state;
  } catch (error) {
    if (state.status === "running") {
      state.status = "blocked";
      state.stopReason = error instanceof Error ? error.message : String(error);
      saveState(paths, state);
      syncProjectState(paths, state);
      appendEvent(paths.eventsFile, "run_error", { runId: state.runId, reason: state.stopReason });
      writeHandoff(paths, state, loaded.document);
    }
    throw error;
  } finally {
    releaseLock(paths);
  }
}

function acceptanceContext(cwd: string, stateDir?: string): { paths: WorkflowPaths; state: WorkflowState; document: ReturnType<typeof loadTaskDocument>["document"] } {
  const paths = workflowPaths(cwd, stateDir);
  if (!fileExists(paths.stateFile)) throw new Error(`No workflow state found at ${paths.stateFile}`);
  const state = validateWorkflowState(readJson<unknown>(paths.stateFile));
  const loaded = loadTaskDocument(state.taskSourceFile);
  if (loaded.file !== state.taskSourceFile || loaded.hash !== state.taskSourceHash) {
    throw new Error("Cannot change human acceptance: the task source differs from the saved run. Inspect the task document and start a new run deliberately.");
  }
  return { paths, state, document: loaded.document };
}

function saveAcceptanceState(paths: WorkflowPaths, state: WorkflowState, document: ReturnType<typeof loadTaskDocument>["document"]): void {
  saveState(paths, state);
  syncProjectState(paths, state);
  writeHandoff(paths, state, document);
}

function refreshRunAfterHumanDecision(state: WorkflowState): void {
  if (state.status === "blocked" || state.status === "stopped") return;
  const values = Object.values(state.tasks);
  if (values.some((task) => task.humanAcceptanceStatus === "awaiting_human_acceptance")) {
    state.status = "needs_review";
    state.stopReason = "awaiting_human_acceptance";
    return;
  }
  if (state.status === "limit_reached" && values.some((task) => task.automationStatus === "pending")) return;
  if (values.some((task) => ["blocked", "dependency_blocked", "needs_review", "running", "limit_reached"].includes(task.automationStatus))) {
    state.status = "needs_review";
    return;
  }
  if (state.status === "needs_review" || state.status === "limit_reached") {
    state.status = "completed";
    state.stopReason = "human_acceptance_complete";
  }
}

export function acceptTask(cwd: string, taskId: string, stateDir?: string): WorkflowState {
  const context = acceptanceContext(cwd, stateDir);
  const execution = context.state.tasks[taskId];
  if (!execution) throw new Error(`Task not found in workflow state: ${taskId}`);
  if (execution.humanAcceptanceStatus === "accepted" && execution.automationStatus === "provisionally_complete") return context.state;
  if (execution.automationStatus !== "provisionally_complete" || execution.humanAcceptanceStatus !== "awaiting_human_acceptance") {
    throw new Error(`Task ${taskId} is not awaiting human acceptance (automation=${execution.automationStatus}, human=${execution.humanAcceptanceStatus}).`);
  }

  acquireLock(context.paths, false);
  try {
    assertTaskStateTransition(execution, { automationStatus: "provisionally_complete", humanAcceptanceStatus: "accepted" });
    execution.humanAcceptanceStatus = "accepted";
    execution.humanAcceptanceAt = now();
    execution.humanAcceptanceReason = "Accepted by human review.";
    execution.lastUpdatedAt = now();
    refreshRunAfterHumanDecision(context.state);
    appendEvent(context.paths.eventsFile, "task_human_accepted", { taskId, runId: context.state.runId });
    saveAcceptanceState(context.paths, context.state, context.document);
    return context.state;
  } finally {
    releaseLock(context.paths);
  }
}

export function rejectTask(cwd: string, taskId: string, reason: string, stateDir?: string): WorkflowState {
  if (typeof reason !== "string" || reason.trim().length === 0) throw new Error("Human rejection requires a non-empty reason.");
  const context = acceptanceContext(cwd, stateDir);
  const execution = context.state.tasks[taskId];
  if (!execution) throw new Error(`Task not found in workflow state: ${taskId}`);
  if (execution.humanAcceptanceStatus === "rejected" && execution.automationStatus === "pending") return context.state;
  if (execution.humanAcceptanceStatus === "accepted") throw new Error(`Task ${taskId} is already human-accepted and cannot be rejected.`);
  if (execution.automationStatus !== "provisionally_complete" || execution.humanAcceptanceStatus !== "awaiting_human_acceptance") {
    throw new Error(`Task ${taskId} is not awaiting human acceptance (automation=${execution.automationStatus}, human=${execution.humanAcceptanceStatus}).`);
  }

  acquireLock(context.paths, false);
  try {
    const rejection = reason.trim();
    assertTaskStateTransition(execution, { automationStatus: "pending", humanAcceptanceStatus: "rejected" });
    execution.automationStatus = "pending";
    execution.humanAcceptanceStatus = "rejected";
    execution.humanAcceptanceAt = now();
    execution.humanAcceptanceReason = rejection;
    execution.lastAssessment = "Human rejected the provisional completion.";
    execution.lastFeedback = `Human rejection: ${rejection}`;
    execution.blockerReason = undefined;
    execution.repeatedOutcomes = 0;
    execution.lastOutcomeHash = undefined;
    execution.lastUpdatedAt = now();

    const invalidatedTaskIds = transitiveDependants(context.document, taskId);
    const invalidationReason = `Invalidated because dependency ${taskId} was rejected: ${rejection}`;
    for (const invalidatedTaskId of invalidatedTaskIds) {
      const descendant = context.state.tasks[invalidatedTaskId];
      if (!descendant) continue;
      assertTaskStateTransition(descendant, { automationStatus: "dependency_blocked", humanAcceptanceStatus: "not_requested" });
      descendant.automationStatus = "dependency_blocked";
      descendant.humanAcceptanceStatus = "not_requested";
      descendant.blockerReason = invalidationReason;
      descendant.lastFeedback = invalidationReason;
      descendant.lastUpdatedAt = now();
    }
    context.state.status = "needs_review";
    context.state.stopReason = "human_rejection_requires_rework";
    appendEvent(context.paths.eventsFile, "task_human_rejected", { taskId, reason: rejection, invalidatedTaskIds });
    saveAcceptanceState(context.paths, context.state, context.document);
    return context.state;
  } finally {
    releaseLock(context.paths);
  }
}

export function readWorkflowStatus(cwd: string, stateDir?: string): WorkflowState {
  const paths = workflowPaths(cwd, stateDir);
  if (!fileExists(paths.stateFile)) throw new Error(`No workflow state found at ${paths.stateFile}`);
  return validateWorkflowState(readJson<unknown>(paths.stateFile));
}
