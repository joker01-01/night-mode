const assert = require("node:assert/strict");
const test = require("node:test");
const {
  dependencyReadiness,
  formatUnmetDependencies,
  propagateDependencyBlocks,
  selectReadyTask
} = require("../dist/scheduler.js");

function task(id, dependsOn = []) {
  return { id, title: id, objective: id, acceptanceCriteria: ["done"], verification: ["node -e \"process.exit(0)\""], dependsOn };
}

function state(tasks) {
  return {
    schemaVersion: 2,
    runId: "scheduler-test",
    mode: "night",
    status: "running",
    taskSourceFile: "tasks.json",
    taskSourceHash: "a".repeat(64),
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    initialGitClean: true,
    gitBaseline: { initialCommit: null, initialStatus: [], initialChangedPaths: [], representationHash: "b".repeat(64) },
    preflightWarnings: [],
    checkpointAllowed: true,
    tasks: Object.fromEntries(tasks.map((item) => [item.id, {
      automationStatus: "pending",
      humanAcceptanceStatus: "not_requested",
      attempts: 0,
      lastUpdatedAt: "2026-01-01T00:00:00.000Z",
      repeatedOutcomes: 0
    }]))
  };
}

test("Night selection follows document order and never bypasses dependencies", () => {
  const document = { schemaVersion: 2, tasks: [task("a"), task("b", ["a"]), task("c", ["a"]), task("d", ["b", "c"])] };
  const run = state(document.tasks);
  assert.equal(selectReadyTask(document, run).id, "a");
  run.tasks.a.automationStatus = "provisionally_complete";
  assert.equal(selectReadyTask(document, run).id, "b");
  assert.equal(dependencyReadiness(document.tasks[3], run).ready, false);
  run.tasks.b.automationStatus = "provisionally_complete";
  assert.equal(selectReadyTask(document, run).id, "c");
  run.tasks.c.automationStatus = "provisionally_complete";
  assert.equal(selectReadyTask(document, run).id, "d");
});

test("a task blocker propagates transitively while independent work remains runnable", () => {
  const document = { schemaVersion: 2, tasks: [task("blocked"), task("independent"), task("child", ["blocked"]), task("grandchild", ["child"])] };
  const run = state(document.tasks);
  run.tasks.blocked.automationStatus = "blocked";
  const changed = propagateDependencyBlocks(document, run);
  assert.deepEqual(changed, ["child", "grandchild"]);
  assert.equal(run.tasks.child.automationStatus, "dependency_blocked");
  assert.equal(run.tasks.grandchild.automationStatus, "dependency_blocked");
  assert.equal(selectReadyTask(document, run).id, "independent");
});

test("dependency-blocked work reopens when its prerequisite becomes automation-complete", () => {
  const document = { schemaVersion: 2, tasks: [task("a"), task("b", ["a"])] };
  const run = state(document.tasks);
  run.tasks.a.automationStatus = "blocked";
  propagateDependencyBlocks(document, run);
  assert.equal(run.tasks.b.automationStatus, "dependency_blocked");
  run.tasks.a.automationStatus = "provisionally_complete";
  assert.deepEqual(propagateDependencyBlocks(document, run), ["b"]);
  assert.equal(run.tasks.b.automationStatus, "pending");
});

test("Interactive dependency errors identify unmet task statuses", () => {
  const document = { schemaVersion: 2, tasks: [task("a"), task("b", ["a"])] };
  const run = state(document.tasks);
  assert.equal(formatUnmetDependencies(document.tasks[1], run), "Task b is not dependency-ready. Unmet dependencies: a=pending.");
});
