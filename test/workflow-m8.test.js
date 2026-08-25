const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const test = require("node:test");
const { rejectTask, runWorkflow } = require("../dist/workflow.js");
const { createCheckpoint } = require("../dist/git.js");

function gitDirectory(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  childProcess.execFileSync("git", ["init"], { cwd: directory, stdio: "ignore" });
  return directory;
}

function commitAll(directory, message) {
  childProcess.execFileSync("git", ["add", "--all"], { cwd: directory, stdio: "ignore" });
  childProcess.execFileSync("git", ["-c", "user.name=Workflow Test", "-c", "user.email=workflow@example.invalid", "commit", "-m", message], { cwd: directory, stdio: "ignore" });
}

function taskDocument(file) {
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 2,
    tasks: [{ id: "one", title: "One", objective: "Create the product file", acceptanceCriteria: ["The product file exists"], verification: ["node -e \"process.exit(0)\""], dependsOn: [] }]
  }));
}

function fakeCodex(directory, productFile) {
  const file = path.join(directory, "fake-codex.js");
  const proposal = {
    outcomeSummary: "The product file is ready for human acceptance.",
    importantDecisions: ["Keep machine-state artifacts out of checkpoints."],
    knownProblems: ["Real Codex acceptance remains outstanding."],
    verificationEvidence: ["Declared verification passed."],
    nextActions: ["Inspect the checkpoint and handoff."],
    humanAcceptanceActions: ["Accept or reject after inspection."]
  };
  const work = { status: "COMPLETE", assessment: "Created the product file.", evidence: ["Product file exists."], nextStep: "Review.", blockerReason: "", projectStateProposal: proposal };
  const review = { decision: "SHIP", assessment: "Ready.", feedback: "Ready for human acceptance.", evidence: ["Reviewer inspected the product file."], projectStateReview: { decision: "APPROVE", proposal, feedback: "Project state approved." } };
  fs.writeFileSync(file, `
const fs = require("node:fs");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-last-message");
const outputFile = args[outputIndex + 1];
const sandboxIndex = args.indexOf("--sandbox");
const phase = sandboxIndex >= 0 && args[sandboxIndex + 1] === "workspace-write" ? "work" : "review";
if (phase === "work") fs.writeFileSync(${JSON.stringify(productFile)}, "workflow output\\n");
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
    maxTasks: 1,
    maxStagnantAttempts: 2,
    totalRuntimeSeconds: 30,
    idleTimeoutSeconds: 2,
    hardTimeoutSeconds: 5,
    checkpoint: true,
    allowDirty: false,
    reclaimStaleLock: false,
    codexBin,
    ...overrides
  };
}

test("checkpoint stages only workflow paths and excludes machine-state files", () => {
  const directory = gitDirectory("workflow-m8-git-");
  fs.writeFileSync(path.join(directory, "tracked.txt"), "baseline\n");
  fs.writeFileSync(path.join(directory, "unrelated.txt"), "unrelated\n");
  commitAll(directory, "baseline");
  fs.writeFileSync(path.join(directory, "workflow.txt"), "workflow\n");
  fs.writeFileSync(path.join(directory, "PROJECT_STATE.md"), "human state\n");
  fs.writeFileSync(path.join(directory, "MORNING_REPORT.md"), "morning\n");
  fs.mkdirSync(path.join(directory, ".codex", "workflow"), { recursive: true });
  fs.writeFileSync(path.join(directory, ".codex", "workflow", "run-state.json"), "{}\n");

  const checkpoint = createCheckpoint(directory, "workflow: selected paths", ".codex/workflow");
  assert.equal(typeof checkpoint, "string");
  const committed = childProcess.execFileSync("git", ["show", "--format=", "--name-only", "HEAD"], { cwd: directory, encoding: "utf8" });
  assert.match(committed, /workflow\.txt/);
  assert.doesNotMatch(committed, /unrelated\.txt|PROJECT_STATE\.md|MORNING_REPORT\.md|run-state\.json/);
  assert.equal(fs.existsSync(path.join(directory, "unrelated.txt")), true);
});

test("checkpoint is created after provisional completion and survives human rejection", async () => {
  const directory = gitDirectory("workflow-m8-checkpoint-");
  const taskFile = path.join(directory, "tasks.json");
  const productFile = path.join(directory, "product.txt");
  taskDocument(taskFile);
  const codexBin = fakeCodex(directory, productFile);
  commitAll(directory, "workflow fixtures");

  const state = await runWorkflow(options(directory, taskFile, codexBin));
  assert.equal(state.tasks.one.humanAcceptanceStatus, "awaiting_human_acceptance");
  assert.equal(typeof state.tasks.one.checkpoint, "string");
  assert.equal(fs.existsSync(productFile), true);
  const events = fs.readFileSync(path.join(directory, ".codex", "workflow", "events.jsonl"), "utf8");
  assert.ok(events.indexOf('"event":"task_provisionally_completed"') < events.indexOf('"event":"checkpoint_created"'));
  const committed = childProcess.execFileSync("git", ["show", "--format=", "--name-only", "HEAD"], { cwd: directory, encoding: "utf8" });
  assert.match(committed, /product\.txt/);
  assert.doesNotMatch(committed, /PROJECT_STATE\.md|MORNING_REPORT\.md|run-state\.json/);

  const rejected = rejectTask(directory, "one", "The product needs another review.");
  assert.equal(rejected.tasks.one.humanAcceptanceStatus, "rejected");
  assert.equal(typeof rejected.tasks.one.checkpoint, "string");
  assert.match(fs.readFileSync(path.join(directory, ".codex", "workflow", "HANDOFF.md"), "utf8"), /preserved checkpoint/);
  assert.equal(childProcess.execFileSync("git", ["log", "-1", "--pretty=%s"], { cwd: directory, encoding: "utf8" }).trim(), "workflow: one One");
});
