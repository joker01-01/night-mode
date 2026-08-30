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
export type QualityGateKind = "integration" | "user_path";
export type ReadinessLevel = 0 | 1 | 2 | 3 | 4;
export type ProjectMemoryKind = "decision" | "learning" | "constraint";
export type ProjectMemoryStatus = "active" | "stale" | "missing" | "expired" | "archived";

export interface ProjectMemoryCitationCandidate {
  path: string;
  startLine: number;
  endLine: number;
}

export interface ProjectMemoryCandidate {
  kind: ProjectMemoryKind;
  statement: string;
  tags: string[];
  citations: ProjectMemoryCitationCandidate[];
}

export interface ProjectMemoryCitation extends ProjectMemoryCitationCandidate {
  text: string;
  textSha256: string;
}

export interface ProjectMemoryEntry {
  id: string;
  kind: ProjectMemoryKind;
  statement: string;
  tags: string[];
  citations: ProjectMemoryCitation[];
  status: ProjectMemoryStatus;
  createdAt: string;
  lastValidatedAt: string;
  lastUsedAt?: string;
  retentionDays: number;
  source: "reviewer" | "human";
  sourceRunId?: string;
  sourceTaskId?: string;
  staleReason?: string;
  archivedAt?: string;
  archiveReason?: string;
}

export interface ProjectMemoryStore {
  schemaVersion: 1;
  entries: ProjectMemoryEntry[];
}

export interface QualityGateDefinition {
  id: string;
  kind: QualityGateKind;
  command: string;
  evidencePaths: string[];
}

export interface ReadinessRequirements {
  requiredCommands: string[];
  requiredEnvironment: string[];
  network: "none" | "optional" | "required";
  bootstrap?: {
    installCommand: string;
    checkCommand: string;
  };
}

export interface TaskDefinition {
  id: string;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  verification: string[];
  dependsOn: string[];
  qualityGates?: QualityGateDefinition[];
}

export interface TaskDocument {
  schemaVersion: 2;
  readiness?: ReadinessRequirements;
  tasks: TaskDefinition[];
}

export interface ProjectStateProposal {
  outcomeSummary: string;
  importantDecisions: string[];
  knownProblems: string[];
  verificationEvidence: string[];
  nextActions: string[];
  humanAcceptanceActions: string[];
  memoryCandidates: ProjectMemoryCandidate[];
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
  qualityGates?: QualityGateResult[];
}

export interface QualityGateEvidence {
  path: string;
  exists: boolean;
  regularFile: boolean;
  fresh: boolean;
  bytes?: number;
  sha256?: string;
  failure?: string;
}

export interface QualityGateResult {
  id: string;
  kind: QualityGateKind;
  status: "passed" | "failed";
  command: CommandResult;
  evidence: QualityGateEvidence[];
  failure?: string;
}

export interface ReadinessCheck {
  code: string;
  status: "pass" | "warning" | "blocker";
  detail: string;
}

export interface ReadinessAssessment {
  schemaVersion: 1;
  generatedAt: string;
  taskSourceFile: string;
  level: ReadinessLevel;
  minimumLevel: ReadinessLevel;
  ready: boolean;
  summary: string;
  checks: ReadinessCheck[];
  bootstrapCheck?: CommandResult;
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
  readiness?: ReadinessAssessment;
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
  readinessFile: string;
  readinessReportFile: string;
  readinessDir: string;
  projectMemoryFile: string;
  projectMemoryReportFile: string;
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
  minReadinessLevel?: ReadinessLevel;
}
