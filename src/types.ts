export type Mode = "interactive" | "night";
export type TaskAutomationStatus =
  | "pending"
  | "running"
  | "needs_review"
  | "provisionally_complete"
  | "blocked"
  | "dependency_blocked"
  | "limit_reached";
export type HumanAcceptanceStatus = "not_requested" | "awaiting_human_acceptance" | "accepted" | "rejected";
export type TaskOutcome = TaskAutomationStatus | "completed" | "rejected";
export type TaskStatus = TaskOutcome;
export type RunStatus = "running" | "completed" | "blocked" | "stopped" | "needs_review" | "limit_reached";
export type ValidationStatus = "not_configured" | "passed" | "failed";
export type ProjectStateReviewDecision = "APPROVE" | "CORRECT";
export type WorkflowPhase = "worker" | "validation" | "reviewer";

export interface TaskDefinition {
  id: string;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  verification: string[];
  dependsOn: string[];
}

export interface TaskDocument {
  schemaVersion: 2;
  tasks: TaskDefinition[];
}

export interface ProjectStateProposal {
  outcomeSummary: string;
  importantDecisions: string[];
  knownProblems: string[];
  verificationEvidence: string[];
  nextActions: string[];
  humanAcceptanceActions: string[];
}

export interface ProjectStateReview {
  decision: ProjectStateReviewDecision;
  proposal: ProjectStateProposal;
  feedback: string;
}

export interface CommandResult {
  command: string;
  exitCode: number;
  error?: string;
  timedOut?: "idle" | "hard";
  outputFile: string;
  startedAt: string;
  endedAt: string;
}

export interface ValidationResult {
  status: ValidationStatus;
  commands: CommandResult[];
}

export type FailurePhase = "worker" | "validation" | "reviewer" | "controller";

export interface WorkResult {
  status: "IN_PROGRESS" | "COMPLETE" | "BLOCKED";
  assessment: string;
  evidence: string[];
  nextStep: string;
  blockerReason?: string;
  projectStateProposal?: ProjectStateProposal;
}

export interface ReviewResult {
  decision: "SHIP" | "REVISE" | "BLOCKED";
  assessment: string;
  feedback: string;
  evidence: string[];
  projectStateReview?: ProjectStateReview;
}

export interface FailureAttempt {
  at: string;
  kind: string;
  detail: string;
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
}

export interface FailureRecord {
  attempts: FailureAttempt[];
  diversityRequired: boolean;
}

export interface FailureMemory {
  schemaVersion: 1;
  tasks: Record<string, FailureRecord>;
}

export interface TaskExecution {
  automationStatus: TaskAutomationStatus;
  humanAcceptanceStatus: HumanAcceptanceStatus;
  attempts: number;
  lastUpdatedAt: string;
  lastDecision?: string;
  lastAssessment?: string;
  lastFeedback?: string;
  blockerReason?: string;
  validation?: ValidationResult;
  changedPaths?: string[];
  lastFailure?: FailureAttempt;
  humanAcceptanceReason?: string;
  humanAcceptanceAt?: string;
  checkpoint?: string;
  checkpointError?: string;
  repeatedOutcomes: number;
  lastOutcomeHash?: string;
  lastPhase?: WorkflowPhase;
  lastRerunReason?: string;
}

export interface RunLimits {
  totalRuntimeSeconds: number;
  maxTasks: number;
  maxAttempts: number;
}

export interface GitBaseline {
  initialCommit: string | null;
  initialStatus: string[];
  initialChangedPaths: string[];
  representationHash: string;
}

export interface WorkflowState {
  schemaVersion: 2;
  runId: string;
  mode: Mode;
  status: RunStatus;
  taskSourceFile: string;
  taskSourceHash: string;
  startedAt: string;
  updatedAt: string;
  stopReason?: string;
  initialGitClean: boolean | null;
  gitBaseline: GitBaseline;
  preflightWarnings: string[];
  checkpointAllowed: boolean;
  targetCwd?: string;
  budgetStartedAt?: string;
  tasksProcessed?: number;
  limits?: RunLimits;
  approvedProjectState?: ProjectStateProposal;
  projectStateReviewDecision?: ProjectStateReviewDecision;
  tasks: Record<string, TaskExecution>;
}

export interface WorkflowPaths {
  cwd: string;
  stateDir: string;
  stateFile: string;
  failureFile: string;
  eventsFile: string;
  lockDir: string;
  lockFile: string;
  pauseFile: string;
  stopFile: string;
  workSchemaFile: string;
  reviewSchemaFile: string;
  handoffFile: string;
  validationDir: string;
  phaseDir: string;
  projectStateFile: string;
}

export interface RunOptions {
  cwd: string;
  taskFile: string;
  stateDir?: string;
  mode: Mode;
  taskId?: string;
  resume: boolean;
  maxAttempts: number;
  maxTasks: number;
  maxStagnantAttempts: number;
  idleTimeoutSeconds: number;
  hardTimeoutSeconds: number;
  checkpoint: boolean;
  allowDirty: boolean;
  reclaimStaleLock: boolean;
  codexBin: string;
  totalRuntimeSeconds: number;
}
