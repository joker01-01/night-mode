const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { MANAGED_END, MANAGED_START, renderManagedProjectState, updateManagedProjectState } = require("../dist/project-state.js");
const { runWorkflow } = require("../dist/workflow.js");

const proposal = {
  outcomeSummary: "The reviewed task is ready for human acceptance.",
  importantDecisions: ["Keep the task document immutable."],
  knownProblems: ["Real Codex acceptance remains outstanding."],
  verificationEvidence: ["npm test passed."],
  nextActions: ["Inspect the generated evidence."],
  humanAcceptanceActions: ["Accept or reject after inspection."]
};

function state(status = "needs_review") {
  return {
    schemaVersion: 2,
    runId: "project-state-test",
    mode: "interactive",
    status,
    taskSourceFile: "tasks.json",
    taskSourceHash: "a".repeat(64),
    startedAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    initialGitClean: true,
    gitBaseline: { initialCommit: null, initialStatus: [], initialChangedPaths: [], representationHash: "b".repeat(64) },
    preflightWarnings: [],
    checkpointAllowed: false,
    approvedProjectState: proposal,
    projectStateReviewDecision: "APPROVE",
    tasks: {
      one: {
        automationStatus: "provisionally_complete",
        humanAcceptanceStatus: "awaiting_human_acceptance",
        attempts: 1,
        lastUpdatedAt: "2026-08-22T00:00:00.000Z",
        repeatedOutcomes: 0
      }
    }
  };
}

test("managed PROJECT_STATE updates preserve human-owned bytes and replace only the managed section", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-project-state-"));
  const file = path.join(directory, "PROJECT_STATE.md");
  const humanPrefix = "# Human-owned heading\r\n\r\nKeep this exact text.\r\n";
  fs.writeFileSync(file, humanPrefix, "utf8");
  updateManagedProjectState(file, state(), proposal);
  const first = fs.readFileSync(file, "utf8");
  const firstStart = first.indexOf(MANAGED_START);
  const firstEnd = first.indexOf(MANAGED_END);
  assert.equal(first.slice(0, firstStart), humanPrefix);
  assert.equal(first.slice(firstStart, firstEnd + MANAGED_END.length).includes("The reviewed task"), true);
  assert.equal(first.split(MANAGED_START).length - 1, 1);
  assert.equal(first.split(MANAGED_END).length - 1, 1);

  const humanSuffix = "\r\n\r\nHuman-owned tail.\r\n";
  fs.writeFileSync(file, `${humanPrefix}${first.slice(firstStart, firstEnd + MANAGED_END.length)}${humanSuffix}`, "utf8");
  const beforeReplace = fs.readFileSync(file, "utf8");
  updateManagedProjectState(file, state("completed"), { ...proposal, outcomeSummary: "Updated reviewed outcome." });
  const replaced = fs.readFileSync(file, "utf8");
  const replacedStart = replaced.indexOf(MANAGED_START);
  const replacedEnd = replaced.indexOf(MANAGED_END);
  assert.equal(replaced.slice(0, replacedStart), beforeReplace.slice(0, beforeReplace.indexOf(MANAGED_START)));
  assert.equal(replaced.slice(replacedEnd + MANAGED_END.length), beforeReplace.slice(beforeReplace.indexOf(MANAGED_END) + MANAGED_END.length));
  assert.match(replaced, /Updated reviewed outcome/);
});

test("managed PROJECT_STATE is created when absent and malformed markers are rejected", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-project-state-create-"));
  const file = path.join(directory, "PROJECT_STATE.md");
  updateManagedProjectState(file, state(), proposal);
  assert.equal(fs.existsSync(file), true);
  assert.match(fs.readFileSync(file, "utf8"), /codex-workflow:managed:start/);

  fs.writeFileSync(file, "Human\n\n<!-- codex-workflow:managed:start -->\n", "utf8");
  const before = fs.readFileSync(file);
  assert.throws(() => updateManagedProjectState(file, state(), proposal), /Invalid managed PROJECT_STATE/);
  assert.deepEqual(fs.readFileSync(file), before);
});

test("managed rendering exposes current task, decisions, evidence, risks, and next actions", () => {
  const rendered = renderManagedProjectState(state(), proposal);
  assert.match(rendered, /Current task state/);
  assert.match(rendered, /Keep the task document immutable/);
  assert.match(rendered, /Real Codex acceptance remains outstanding/);
  assert.match(rendered, /npm test passed/);
  assert.match(rendered, /Inspect the generated evidence/);
  assert.match(rendered, /Accept or reject after inspection/);
});

test("a stop lifecycle writes an honest managed project state summary", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-project-state-stop-"));
  childProcess.execFileSync("git", ["init"], { cwd: directory, stdio: "ignore" });
  const taskFile = path.join(directory, "tasks.json");
  fs.writeFileSync(taskFile, JSON.stringify({
    schemaVersion: 2,
    tasks: [{ id: "one", title: "One", objective: "Stop safely", acceptanceCriteria: ["Evidence exists"], verification: ["node -e \\\"process.exit(0)\\\""], dependsOn: [] }]
  }));
  const stopFile = path.join(directory, ".codex", "workflow", "STOP");
  fs.mkdirSync(path.dirname(stopFile), { recursive: true });
  fs.writeFileSync(stopFile, "stop\n");

  const result = await runWorkflow({
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

  assert.equal(result.status, "stopped");
  assert.match(fs.readFileSync(path.join(directory, "PROJECT_STATE.md"), "utf8"), /Workflow status: `stopped` \(stop_file_detected\)/);
});
