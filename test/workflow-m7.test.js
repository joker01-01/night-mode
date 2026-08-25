const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const test = require("node:test");
const { runWorkflow } = require("../dist/workflow.js");

function gitDirectory(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  childProcess.execFileSync("git", ["init"], { cwd: directory, stdio: "ignore" });
  return directory;
}

function taskDocument(file, ids = ["one"]) {
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 2,
    tasks: ids.map((id) => ({
      id,
      title: id,
      objective: `Complete ${id}`,
      acceptanceCriteria: ["Evidence exists"],
      verification: ["node -e \"process.exit(0)\""],
      dependsOn: []
    }))
  }));
}

function proposal() {
  return {
    outcomeSummary: "The task is ready for human acceptance.",
    importantDecisions: ["Keep the task source immutable."],
    knownProblems: [],
    verificationEvidence: ["Declared verification passed."],
    nextActions: ["Inspect the handoff."],
    humanAcceptanceActions: ["Accept or reject after inspection."]
  };
}

function fakeCodex(directory, decision = "SHIP") {
  const file = path.join(directory, "fake-codex.js");
  const work = { status: "COMPLETE", assessment: "Implemented.", evidence: ["Evidence exists."], nextStep: "Review.", blockerReason: "", projectStateProposal: proposal() };
  const review = { decision, assessment: decision === "SHIP" ? "Ready." : "Needs another attempt.", feedback: decision === "SHIP" ? "Ready." : "The same defect remains.", evidence: ["Reviewed."], projectStateReview: { decision: "APPROVE", proposal: proposal(), feedback: "Project state reviewed." } };
  fs.writeFileSync(file, `
const fs = require("node:fs");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-last-message");
const outputFile = args[outputIndex + 1];
const sandboxIndex = args.indexOf("--sandbox");
const phase = sandboxIndex >= 0 && args[sandboxIndex + 1] === "workspace-write" ? "work" : "review";
const payload = phase === "work" ? ${JSON.stringify(work)} : ${JSON.stringify(review)};
fs.writeFileSync(outputFile, JSON.stringify(payload));
process.exit(0);
`);
  return file;
}

function options(directory, taskFile, codexBin, overrides = {}) {
  return {
    cwd: directory,
    taskFile,
    mode: "night",
    resume: false,
    maxAttempts: 1,
    maxTasks: 10,
    maxStagnantAttempts: 2,
    totalRuntimeSeconds: 30,
    idleTimeoutSeconds: 2,
    hardTimeoutSeconds: 5,
    checkpoint: false,
    allowDirty: true,
    reclaimStaleLock: false,
    codexBin,
    ...overrides
  };
}

test("total runtime limit stops before starting work and writes Night artifacts", async () => {
  const directory = gitDirectory("workflow-m7-runtime-;");
  const taskFile = path.join(directory, "tasks.json");
  taskDocument(taskFile);
  const state = await runWorkflow(options(directory, taskFile, "codex-does-not-exist", { totalRuntimeSeconds: 0 }));
  assert.equal(state.status, "limit_reached");
  assert.equal(state.stopReason, "total_runtime_reached");
  assert.equal(state.tasks.one.attempts, 0);
  assert.equal(state.limits.totalRuntimeSeconds, 0);
  assert.equal(fs.existsSync(path.join(directory, "MORNING_REPORT.md")), true);
});

test("Night Shift stops at max tasks without misclassifying the next task", async () => {
  const directory = gitDirectory("workflow-m7-tasks-");
  const taskFile = path.join(directory, "tasks.json");
  taskDocument(taskFile, ["one", "two"]);
  const state = await runWorkflow(options(directory, taskFile, fakeCodex(directory), { maxTasks: 1 }));
  assert.equal(state.status, "limit_reached");
  assert.equal(state.stopReason, "max_tasks_reached");
  assert.equal(state.tasksProcessed, 1);
  assert.equal(state.tasks.one.automationStatus, "provisionally_complete");
  assert.equal(state.tasks.two.automationStatus, "pending");
  assert.match(fs.readFileSync(path.join(directory, "MORNING_REPORT.md"), "utf8"), /Outcome: `limit_reached`/);
});

test("per-task attempt limits produce limit_reached instead of blocked", async () => {
  const directory = gitDirectory("workflow-m7-attempts-");
  const taskFile = path.join(directory, "tasks.json");
  taskDocument(taskFile);
  const state = await runWorkflow(options(directory, taskFile, fakeCodex(directory, "REVISE"), { maxAttempts: 1 }));
  assert.equal(state.status, "limit_reached");
  assert.equal(state.tasks.one.automationStatus, "limit_reached");
  assert.notEqual(state.tasks.one.automationStatus, "blocked");
  assert.match(state.tasks.one.lastAssessment, /Attempt limit/);
  assert.match(fs.readFileSync(path.join(directory, "MORNING_REPORT.md"), "utf8"), /Limit reached/);
});

test("PAUSE continues checking STOP and exits at a safe boundary", async () => {
  const directory = gitDirectory("workflow-m7-pause-stop-");
  const taskFile = path.join(directory, "tasks.json");
  taskDocument(taskFile);
  const pauseFile = path.join(directory, ".codex", "workflow", "PAUSE");
  const stopFile = path.join(directory, ".codex", "workflow", "STOP");
  fs.mkdirSync(path.dirname(pauseFile), { recursive: true });
  fs.writeFileSync(pauseFile, "pause\n");
  const running = runWorkflow(options(directory, taskFile, fakeCodex(directory)));
  await new Promise((resolve) => setTimeout(resolve, 150));
  fs.writeFileSync(stopFile, "stop\n");
  const state = await running;
  assert.equal(state.status, "stopped");
  assert.equal(state.stopReason, "stop_file_detected");
  assert.equal(state.tasks.one.attempts, 0);
  assert.equal(fs.existsSync(path.join(directory, ".codex", "workflow", "HANDOFF.md")), true);
});

test("resume reopens limits and records why an interrupted phase is rerun", async () => {
  const directory = gitDirectory("workflow-m7-resume-");
  const taskFile = path.join(directory, "tasks.json");
  taskDocument(taskFile);
  const stopFile = path.join(directory, ".codex", "workflow", "STOP");
  fs.mkdirSync(path.dirname(stopFile), { recursive: true });
  fs.writeFileSync(stopFile, "stop\n");
  const stopped = await runWorkflow(options(directory, taskFile, "codex-does-not-exist"));
  assert.equal(stopped.status, "stopped");
  const stateFile = path.join(directory, ".codex", "workflow", "run-state.json");
  const interrupted = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  interrupted.status = "running";
  interrupted.stopReason = undefined;
  interrupted.tasks.one.automationStatus = "running";
  interrupted.tasks.one.attempts = 1;
  interrupted.tasks.one.lastPhase = "worker";
  fs.writeFileSync(stateFile, JSON.stringify(interrupted, null, 2));
  fs.rmSync(stopFile);

  const resumed = await runWorkflow(options(directory, taskFile, fakeCodex(directory), { resume: true, maxAttempts: 2 }));
  assert.equal(resumed.tasks.one.automationStatus, "provisionally_complete");
  const events = fs.readFileSync(path.join(directory, ".codex", "workflow", "events.jsonl"), "utf8");
  assert.match(events, /"event":"phase_rerun_scheduled"/);
  assert.match(events, /resume_after_process_interruption/);
  assert.match(events, /"event":"run_resumed"/);
});
