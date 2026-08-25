const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const test = require("node:test");
const { runWorkflow } = require("../dist/workflow.js");

function taskDocument(file) {
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 2,
    tasks: [{ id: "one", title: "One", objective: "Do one thing", acceptanceCriteria: ["Evidence exists"], verification: ["node -e \"process.exit(0)\""], dependsOn: [] }]
  }));
}

test("a missing Codex executable leaves an inspectable blocked task and handoff", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-run-"));
  childProcess.execFileSync("git", ["init"], { cwd: directory, stdio: "ignore" });
  const taskFile = path.join(directory, "tasks.json");
  taskDocument(taskFile);
  const state = await runWorkflow({
    cwd: directory,
    taskFile,
    mode: "interactive",
    taskId: "one",
    resume: false,
    maxAttempts: 1,
    maxTasks: 0,
    maxStagnantAttempts: 2,
    idleTimeoutSeconds: 1,
    hardTimeoutSeconds: 1,
    checkpoint: false,
    reclaimStaleLock: false,
    codexBin: "codex-does-not-exist-for-test"
  });
  assert.equal(state.tasks.one.automationStatus, "blocked");
  assert.match(state.tasks.one.lastFeedback, /phase failed:.*Log:/);
  assert.equal(fs.existsSync(path.join(directory, ".codex", "workflow", "HANDOFF.md")), true);
  assert.match(fs.readFileSync(path.join(directory, "PROJECT_STATE.md"), "utf8"), /Workflow status: `blocked`/);
  assert.equal(fs.existsSync(path.join(directory, ".codex", "workflow", ".lock")), false);
});

test("a non-Git target is rejected during preflight before workflow state is created", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-non-git-run-"));
  const taskFile = path.join(directory, "tasks.json");
  taskDocument(taskFile);
  await assert.rejects(() => runWorkflow({
    cwd: directory,
    taskFile,
    mode: "interactive",
    taskId: "one",
    resume: false,
    maxAttempts: 1,
    maxTasks: 0,
    maxStagnantAttempts: 2,
    idleTimeoutSeconds: 1,
    hardTimeoutSeconds: 1,
    checkpoint: false,
    allowDirty: false,
    reclaimStaleLock: false,
    codexBin: "codex-does-not-exist-for-test"
  }), /Git preflight failed/);
  assert.equal(fs.existsSync(path.join(directory, ".codex", "workflow")), false);
});

test("an explicitly allowed dirty Night run persists its baseline and disables checkpoints", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-dirty-night-"));
  childProcess.execFileSync("git", ["init"], { cwd: directory, stdio: "ignore" });
  fs.writeFileSync(path.join(directory, "tracked.txt"), "tracked\n");
  childProcess.execFileSync("git", ["add", "tracked.txt"], { cwd: directory, stdio: "ignore" });
  childProcess.execFileSync("git", ["-c", "user.name=Workflow Test", "-c", "user.email=workflow@example.invalid", "commit", "-m", "initial"], { cwd: directory, stdio: "ignore" });
  fs.writeFileSync(path.join(directory, "preexisting.txt"), "human change\n");
  const taskFile = path.join(directory, "tasks.json");
  taskDocument(taskFile);
  const state = await runWorkflow({
    cwd: directory,
    taskFile,
    mode: "night",
    resume: false,
    maxAttempts: 1,
    maxTasks: 1,
    maxStagnantAttempts: 2,
    idleTimeoutSeconds: 1,
    hardTimeoutSeconds: 1,
    checkpoint: true,
    allowDirty: true,
    reclaimStaleLock: false,
    codexBin: "codex-does-not-exist-for-test"
  });
  assert.equal(state.initialGitClean, false);
  assert.equal(state.checkpointAllowed, false);
  assert.equal(state.gitBaseline.initialChangedPaths.includes("preexisting.txt"), true);
  assert.match(state.preflightWarnings[0], /--allow-dirty/);
  assert.equal(state.tasks.one.checkpoint, undefined);
});

test("Interactive explains unmet dependencies without starting the worker", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-interactive-deps-"));
  childProcess.execFileSync("git", ["init"], { cwd: directory, stdio: "ignore" });
  const taskFile = path.join(directory, "tasks.json");
  fs.writeFileSync(taskFile, JSON.stringify({
    schemaVersion: 2,
    tasks: [
      { id: "base", title: "Base", objective: "Base", acceptanceCriteria: ["done"], verification: ["node -e \"process.exit(0)\""], dependsOn: [] },
      { id: "child", title: "Child", objective: "Child", acceptanceCriteria: ["done"], verification: ["node -e \"process.exit(0)\""], dependsOn: ["base"] }
    ]
  }));
  const state = await runWorkflow({
    cwd: directory,
    taskFile,
    mode: "interactive",
    taskId: "child",
    resume: false,
    maxAttempts: 1,
    maxTasks: 0,
    maxStagnantAttempts: 2,
    idleTimeoutSeconds: 1,
    hardTimeoutSeconds: 1,
    checkpoint: false,
    allowDirty: false,
    reclaimStaleLock: false,
    codexBin: "codex-does-not-exist-for-test"
  });
  assert.equal(state.status, "needs_review");
  assert.equal(state.tasks.child.attempts, 0);
  assert.match(state.tasks.child.lastFeedback, /Unmet dependencies: base=pending/);
});
