const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const test = require("node:test");
const { completionGateSatisfied, runWorkflow } = require("../dist/workflow.js");

function gitDirectory(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  childProcess.execFileSync("git", ["init"], { cwd: directory, stdio: "ignore" });
  return directory;
}

function writeTask(file, verification = ["node -e \"process.exit(0)\""]) {
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 2,
    tasks: [{
      id: "one",
      title: "One",
      objective: "Do one thing",
      acceptanceCriteria: ["Evidence exists"],
      verification,
      dependsOn: []
    }]
  }));
}

function fakeCodex(directory, work, review) {
  const file = path.join(directory, "fake-codex.js");
  const source = `
const fs = require("node:fs");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-last-message");
if (outputIndex < 0) process.exit(2);
const outputFile = args[outputIndex + 1];
const sandboxIndex = args.indexOf("--sandbox");
const phase = sandboxIndex >= 0 && args[sandboxIndex + 1] === "workspace-write" ? "work" : "review";
const payload = phase === "work" ? ${JSON.stringify(work)} : ${JSON.stringify(review)};
if (payload === "__MALFORMED__") fs.writeFileSync(outputFile, "{malformed");
else fs.writeFileSync(outputFile, JSON.stringify(payload));
process.exit(0);
`;
  fs.writeFileSync(file, source);
  return file;
}

function projectStateProposal() {
  return { outcomeSummary: "Task result is available for review.", importantDecisions: [], knownProblems: [], verificationEvidence: ["Declared verification."], nextActions: ["Await the next workflow decision."], humanAcceptanceActions: ["Accept or reject after inspection."] };
}

function work(status = "COMPLETE") {
  return { status, assessment: status === "BLOCKED" ? "Blocked by an external dependency." : "Implemented.", evidence: ["Evidence recorded."], nextStep: "Review.", blockerReason: status === "BLOCKED" ? "External dependency is unavailable." : "", projectStateProposal: projectStateProposal() };
}

function review(decision, feedback = "Needs another attempt.") {
  return { decision, assessment: feedback, feedback, evidence: ["Reviewer inspected the task."], projectStateReview: { decision: "APPROVE", proposal: projectStateProposal(), feedback: "Project state reviewed." } };
}

function options(directory, taskFile, codexBin, overrides = {}) {
  return {
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
    codexBin,
    ...overrides
  };
}

test("completion gate rejects missing verification even when worker and reviewer claim success", () => {
  const incompleteWork = { ...work(), projectStateProposal: undefined };
  const incompleteReview = { ...review("SHIP", "Ready"), projectStateReview: undefined };
  assert.equal(completionGateSatisfied(incompleteWork, review("SHIP", "Ready"), { status: "passed", commands: [] }), false);
  assert.equal(completionGateSatisfied(work(), incompleteReview, { status: "passed", commands: [] }), false);
  assert.equal(completionGateSatisfied(work(), review("SHIP", "Ready"), { status: "not_configured", commands: [] }), false);
  assert.equal(completionGateSatisfied(work(), review("SHIP", "Ready"), { status: "failed", commands: [] }), false);
  assert.equal(completionGateSatisfied(work(), review("SHIP", "Ready"), { status: "passed", commands: [] }), true);
});

test("worker COMPLETE alone never advances a task", async () => {
  const directory = gitDirectory("workflow-m4-worker-only-");
  const taskFile = path.join(directory, "tasks.json");
  writeTask(taskFile);
  const codexBin = fakeCodex(directory, work(), review("REVISE"));
  const state = await runWorkflow(options(directory, taskFile, codexBin));
  assert.notEqual(state.tasks.one.automationStatus, "provisionally_complete");
  assert.equal(state.tasks.one.lastFailure.classification, "review_revise");
  assert.match(state.tasks.one.lastFailure.nextAction, /reviewer feedback/);
});

test("failed verification keeps the task incomplete and exposes the command log", async () => {
  const directory = gitDirectory("workflow-m4-validation-");
  const taskFile = path.join(directory, "tasks.json");
  writeTask(taskFile, ["node -e \"process.exit(1)\""]);
  const codexBin = fakeCodex(directory, work(), review("SHIP", "Ready"));
  const state = await runWorkflow(options(directory, taskFile, codexBin));
  const failure = state.tasks.one.lastFailure;
  assert.notEqual(state.tasks.one.automationStatus, "provisionally_complete");
  assert.equal(failure.classification, "validation_failed");
  assert.equal(failure.phase, "validation");
  assert.match(failure.primaryCause, /Declared verification failed/);
  assert.equal(fs.existsSync(failure.logFile), true);
  const memory = JSON.parse(fs.readFileSync(path.join(directory, ".codex", "workflow", "failure-memory.json"), "utf8"));
  assert.equal(memory.tasks.one.attempts[0].verification.status, "failed");
  assert.match(fs.readFileSync(path.join(directory, ".codex", "workflow", "HANDOFF.md"), "utf8"), /Failure evidence/);
});

test("reviewer BLOCKED becomes a task blocker with reviewer evidence", async () => {
  const directory = gitDirectory("workflow-m4-reviewer-blocked-");
  const taskFile = path.join(directory, "tasks.json");
  writeTask(taskFile);
  const codexBin = fakeCodex(directory, work("BLOCKED"), review("BLOCKED", "Required external service is unavailable."));
  const state = await runWorkflow(options(directory, taskFile, codexBin));
  assert.equal(state.tasks.one.automationStatus, "blocked");
  assert.equal(state.tasks.one.lastFailure.classification, "reviewer_blocked");
  assert.equal(state.tasks.one.lastFailure.phase, "reviewer");
  assert.match(state.tasks.one.blockerReason, /External dependency/);
});

test("malformed agent output is recorded with its phase log", async () => {
  const directory = gitDirectory("workflow-m4-malformed-");
  const taskFile = path.join(directory, "tasks.json");
  writeTask(taskFile);
  const codexBin = fakeCodex(directory, "__MALFORMED__", review("SHIP", "Ready"));
  const state = await runWorkflow(options(directory, taskFile, codexBin));
  const failure = state.tasks.one.lastFailure;
  assert.equal(failure.classification, "malformed_output");
  assert.equal(failure.phase, "worker");
  assert.equal(fs.existsSync(failure.logFile), true);
  assert.match(failure.primaryCause, /Log:/);
});

test("repeated outcomes require a different approach and then block", async () => {
  const directory = gitDirectory("workflow-m4-repeated-");
  const taskFile = path.join(directory, "tasks.json");
  writeTask(taskFile);
  const codexBin = fakeCodex(directory, work(), review("REVISE", "The same defect remains."));
  const state = await runWorkflow(options(directory, taskFile, codexBin, { maxAttempts: 3, maxStagnantAttempts: 1 }));
  assert.equal(state.tasks.one.automationStatus, "blocked");
  assert.equal(state.tasks.one.attempts, 2);
  assert.equal(state.tasks.one.lastFailure.classification, "stagnant_outcome");
  const memory = JSON.parse(fs.readFileSync(path.join(directory, ".codex", "workflow", "failure-memory.json"), "utf8"));
  assert.equal(memory.tasks.one.diversityRequired, true);
  assert.match(fs.readFileSync(path.join(directory, ".codex", "workflow", "failure-memory.json"), "utf8"), /materially different|stagnant_outcome/);
});
