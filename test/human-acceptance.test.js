const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { acceptTask, rejectTask, runWorkflow } = require("../dist/workflow.js");
const { taskOutcome } = require("../dist/state.js");
const { loadTaskDocument } = require("../dist/tasks.js");
const { sha256File, workflowPaths, writeJsonAtomic } = require("../dist/storage.js");

function gitDirectory(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  childProcess.execFileSync("git", ["init"], { cwd: directory, stdio: "ignore" });
  return directory;
}

function writeTasks(file) {
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 2,
    tasks: [
      { id: "base", title: "Base", objective: "Base", acceptanceCriteria: ["base done"], verification: ["node -e \"process.exit(0)\""], dependsOn: [] },
      { id: "child", title: "Child", objective: "Child", acceptanceCriteria: ["child done"], verification: ["node -e \"process.exit(0)\""], dependsOn: ["base"] },
      { id: "grandchild", title: "Grandchild", objective: "Grandchild", acceptanceCriteria: ["grandchild done"], verification: ["node -e \"process.exit(0)\""], dependsOn: ["child"] },
      { id: "independent", title: "Independent", objective: "Independent", acceptanceCriteria: ["independent done"], verification: ["node -e \"process.exit(0)\""], dependsOn: [] }
    ]
  }));
}

function execution(automationStatus, humanAcceptanceStatus) {
  return {
    automationStatus,
    humanAcceptanceStatus,
    attempts: 1,
    lastUpdatedAt: "2026-08-22T00:00:00.000Z",
    repeatedOutcomes: 0
  };
}

function createState(taskStates) {
  const directory = gitDirectory("workflow-m5-");
  const taskFile = path.join(directory, "tasks.json");
  writeTasks(taskFile);
  const loaded = loadTaskDocument(taskFile);
  const paths = workflowPaths(directory);
  const state = {
    schemaVersion: 2,
    runId: "m5-test-run",
    mode: "interactive",
    status: "needs_review",
    taskSourceFile: loaded.file,
    taskSourceHash: loaded.hash,
    startedAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    initialGitClean: true,
    gitBaseline: { initialCommit: null, initialStatus: [], initialChangedPaths: [], representationHash: "b".repeat(64) },
    preflightWarnings: [],
    checkpointAllowed: true,
    approvedProjectState: { outcomeSummary: "Approved task state.", importantDecisions: [], knownProblems: [], verificationEvidence: ["Test evidence."], nextActions: ["Await human action."], humanAcceptanceActions: ["Accept or reject after inspection."] },
    projectStateReviewDecision: "APPROVE",
    tasks: {
      base: taskStates.base ?? execution("pending", "not_requested"),
      child: taskStates.child ?? execution("pending", "not_requested"),
      grandchild: taskStates.grandchild ?? execution("pending", "not_requested"),
      independent: taskStates.independent ?? execution("pending", "not_requested")
    }
  };
  writeJsonAtomic(paths.stateFile, state);
  fs.mkdirSync(paths.phaseDir, { recursive: true });
  const evidenceFile = path.join(paths.phaseDir, "base-attempt-1-work.jsonl");
  fs.writeFileSync(evidenceFile, "preserve this evidence\n");
  return { directory, taskFile, paths, evidenceFile };
}

function fakeCodex(directory) {
  const file = path.join(directory, "fake-codex.js");
  fs.writeFileSync(file, `
const fs = require("node:fs");
const args = process.argv.slice(2);
const output = args[args.indexOf("--output-last-message") + 1];
const isWorker = args[args.indexOf("--sandbox") + 1] === "workspace-write";
fs.writeFileSync(output, JSON.stringify(isWorker
  ? { status: "COMPLETE", assessment: "Implemented.", evidence: ["Evidence exists."], nextStep: "Await human review.", blockerReason: "", projectStateProposal: { outcomeSummary: "Task is ready for human acceptance.", importantDecisions: [], knownProblems: [], verificationEvidence: ["Declared verification passed."], nextActions: ["Await human acceptance."], humanAcceptanceActions: ["Accept or reject after inspection."] } }
  : { decision: "SHIP", assessment: "Ready.", feedback: "Ready for human acceptance.", evidence: ["Reviewed."], projectStateReview: { decision: "APPROVE", proposal: { outcomeSummary: "Task is ready for human acceptance.", importantDecisions: [], knownProblems: [], verificationEvidence: ["Declared verification passed."], nextActions: ["Await human acceptance."], humanAcceptanceActions: ["Accept or reject after inspection."] }, feedback: "Project state approved." } }));
`);
  return file;
}

test("accept finalizes provisional work and repeated accept is idempotent", () => {
  const context = createState({ base: execution("provisionally_complete", "awaiting_human_acceptance") });
  const accepted = acceptTask(context.directory, "base");
  assert.equal(accepted.tasks.base.automationStatus, "provisionally_complete");
  assert.equal(accepted.tasks.base.humanAcceptanceStatus, "accepted");
  assert.equal(taskOutcome(accepted.tasks.base), "completed");
  assert.equal(accepted.status, "completed");
  assert.match(fs.readFileSync(context.paths.handoffFile, "utf8"), /Human accepted/);
  assert.match(fs.readFileSync(path.join(context.directory, "PROJECT_STATE.md"), "utf8"), /human=accepted/);

  const repeated = acceptTask(context.directory, "base");
  assert.equal(repeated.tasks.base.humanAcceptanceStatus, "accepted");
});

test("Interactive success stops awaiting human acceptance instead of claiming final completion", async () => {
  const directory = gitDirectory("workflow-m5-interactive-");
  const taskFile = path.join(directory, "tasks.json");
  const humanOwned = "# Human-owned state\n\nKeep this section unchanged.\n";
  fs.writeFileSync(path.join(directory, "PROJECT_STATE.md"), humanOwned, "utf8");
  fs.writeFileSync(taskFile, JSON.stringify({
    schemaVersion: 2,
    tasks: [{ id: "one", title: "One", objective: "One", acceptanceCriteria: ["done"], verification: ["node -e \"process.exit(0)\""], dependsOn: [] }]
  }));
  const state = await runWorkflow({
    cwd: directory,
    taskFile,
    mode: "interactive",
    taskId: "one",
    resume: false,
    maxAttempts: 1,
    maxTasks: 0,
    maxStagnantAttempts: 2,
    idleTimeoutSeconds: 2,
    hardTimeoutSeconds: 5,
    checkpoint: false,
    allowDirty: false,
    reclaimStaleLock: false,
    codexBin: fakeCodex(directory)
  });
  assert.equal(state.status, "needs_review");
  assert.equal(state.tasks.one.automationStatus, "provisionally_complete");
  assert.equal(state.tasks.one.humanAcceptanceStatus, "awaiting_human_acceptance");
  const projectState = fs.readFileSync(path.join(directory, "PROJECT_STATE.md"), "utf8");
  assert.equal(projectState.slice(0, projectState.indexOf("<!-- codex-workflow:managed:start -->")), humanOwned);
  assert.match(projectState, /Task is ready for human acceptance/);
});

test("reject reopens the task, invalidates transitive dependants, and preserves evidence", () => {
  const context = createState({
    base: execution("provisionally_complete", "awaiting_human_acceptance"),
    child: execution("provisionally_complete", "awaiting_human_acceptance"),
    grandchild: execution("pending", "not_requested")
  });
  const state = rejectTask(context.directory, "base", "Acceptance criterion is not actually demonstrated.");

  assert.equal(state.tasks.base.automationStatus, "pending");
  assert.equal(state.tasks.base.humanAcceptanceStatus, "rejected");
  assert.equal(state.tasks.base.humanAcceptanceReason, "Acceptance criterion is not actually demonstrated.");
  assert.equal(state.tasks.child.automationStatus, "dependency_blocked");
  assert.equal(state.tasks.child.humanAcceptanceStatus, "not_requested");
  assert.equal(state.tasks.grandchild.automationStatus, "dependency_blocked");
  assert.equal(state.tasks.independent.automationStatus, "pending");
  assert.equal(state.status, "needs_review");
  assert.equal(fs.existsSync(context.evidenceFile), true);
  assert.match(fs.readFileSync(context.paths.eventsFile, "utf8"), /invalidatedTaskIds/);
  assert.match(fs.readFileSync(context.paths.handoffFile, "utf8"), /Human rejection/);
  const projectState = fs.readFileSync(path.join(context.directory, "PROJECT_STATE.md"), "utf8");
  assert.match(projectState, /human=rejected/);
  assert.match(projectState, /dependency_blocked/);

  const repeated = rejectTask(context.directory, "base", "A different reason is ignored by the idempotent command.");
  assert.equal(repeated.tasks.base.humanAcceptanceReason, "Acceptance criterion is not actually demonstrated.");
});

test("accept and reject refuse an already final human decision", () => {
  const accepted = createState({ base: { ...execution("provisionally_complete", "accepted"), humanAcceptanceAt: "2026-08-22T00:00:00.000Z" } });
  assert.throws(() => rejectTask(accepted.directory, "base", "Too late."), /already human-accepted/);

  const rejected = createState({ base: execution("pending", "rejected") });
  assert.throws(() => acceptTask(rejected.directory, "base"), /not awaiting human acceptance/);

  const missingReason = createState({ base: execution("provisionally_complete", "awaiting_human_acceptance") });
  assert.throws(() => rejectTask(missingReason.directory, "base", "  "), /non-empty reason/);
});

test("CLI exposes and executes the human acceptance command", () => {
  const context = createState({ base: execution("provisionally_complete", "awaiting_human_acceptance") });
  const cli = path.join(__dirname, "..", "dist", "index.js");
  const help = childProcess.execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.match(help, /accept --task <id>/);
  assert.match(help, /reject --task <id> --reason <text>/);
  assert.match(help, /--total-runtime <seconds>/);
  assert.match(help, /--max-tasks <n>.*default: 10/);
  const output = childProcess.execFileSync(process.execPath, [cli, "accept", "--cwd", context.directory, "--task", "base"], { encoding: "utf8" });
  assert.match(output, /Task base accepted/);

  const rejectedContext = createState({ base: execution("provisionally_complete", "awaiting_human_acceptance") });
  const rejectionOutput = childProcess.execFileSync(process.execPath, [cli, "reject", "--cwd", rejectedContext.directory, "--task", "base", "--reason", "Evidence is incomplete."], { encoding: "utf8" });
  assert.match(rejectionOutput, /Task base rejected/);
});
