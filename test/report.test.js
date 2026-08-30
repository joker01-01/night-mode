const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { writeHandoff } = require("../dist/report.js");
const { workflowPaths } = require("../dist/storage.js");

const proposal = {
  outcomeSummary: "The run contains reviewable work.",
  importantDecisions: ["Keep machine state out of checkpoints."],
  knownProblems: ["One task remains blocked."],
  verificationEvidence: ["Declared verification passed."],
  nextActions: ["Inspect the blocked task."],
  humanAcceptanceActions: ["Accept or reject the awaiting task."]
};

function execution(automationStatus, humanAcceptanceStatus = "not_requested", extra = {}) {
  return {
    automationStatus,
    humanAcceptanceStatus,
    attempts: 1,
    lastUpdatedAt: "2026-08-22T00:00:00.000Z",
    repeatedOutcomes: 0,
    ...extra
  };
}

test("handoff and morning report expose every task outcome and human action", () => {
  const previousCommand = process.env.CODEX_WORKFLOW_COMMAND;
  process.env.CODEX_WORKFLOW_COMMAND = "node /installed/night-mode/scripts/night-mode";
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-report-"));
  const paths = workflowPaths(directory);
  const document = {
    schemaVersion: 2,
    tasks: [
      { id: "awaiting", title: "Awaiting", objective: "Await", acceptanceCriteria: ["Review"], verification: ["npm test"], dependsOn: [] },
      { id: "accepted", title: "Accepted", objective: "Accept", acceptanceCriteria: ["Review"], verification: ["npm test"], dependsOn: [] },
      { id: "rejected", title: "Rejected", objective: "Reject", acceptanceCriteria: ["Review"], verification: ["npm test"], dependsOn: ["accepted"] },
      { id: "blocked", title: "Blocked", objective: "Block", acceptanceCriteria: ["Review"], verification: ["npm test"], dependsOn: [] },
      { id: "dependency", title: "Dependency", objective: "Dependency", acceptanceCriteria: ["Review"], verification: ["npm test"], dependsOn: ["blocked"] },
      { id: "limited", title: "Limited", objective: "Limit", acceptanceCriteria: ["Review"], verification: ["npm test"], dependsOn: [] },
      { id: "pending", title: "Pending", objective: "Pending", acceptanceCriteria: ["Review"], verification: ["npm test"], dependsOn: [] }
    ]
  };
  const state = {
    schemaVersion: 2,
    runId: "report-run",
    mode: "night",
    status: "needs_review",
    stopReason: "awaiting_human_acceptance",
    taskSourceFile: path.join(directory, "tasks.json"),
    taskSourceHash: "a".repeat(64),
    startedAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:10:00.000Z",
    budgetStartedAt: "2026-08-22T00:00:00.000Z",
    tasksProcessed: 6,
    limits: { totalRuntimeSeconds: 28800, maxTasks: 10, maxAttempts: 3 },
    targetCwd: directory,
    initialGitClean: false,
    gitBaseline: { initialCommit: "abc", initialStatus: [" M preexisting.txt"], initialChangedPaths: ["preexisting.txt"], representationHash: "b".repeat(64) },
    preflightWarnings: ["Night Shift used --allow-dirty."],
    checkpointAllowed: false,
    approvedProjectState: proposal,
    projectStateReviewDecision: "APPROVE",
    tasks: {
      awaiting: execution("provisionally_complete", "awaiting_human_acceptance", { lastDecision: "SHIP", lastAssessment: "Ready.", lastFeedback: "Ready for human acceptance.", changedPaths: ["workflow.txt"], validation: { status: "passed", commands: [{ command: "npm test", exitCode: 0, outputFile: "test.log", startedAt: "2026-08-22T00:01:00.000Z", endedAt: "2026-08-22T00:02:00.000Z" }] } }),
      accepted: execution("provisionally_complete", "accepted", { checkpoint: "def456" }),
      rejected: execution("pending", "rejected", { humanAcceptanceReason: "Needs correction.", lastFeedback: "Human rejection: Needs correction.", checkpoint: "ghi789" }),
      blocked: execution("blocked", "not_requested", { blockerReason: "External dependency unavailable." }),
      dependency: execution("dependency_blocked", "not_requested", { blockerReason: "Dependency blocked by: blocked." }),
      limited: execution("limit_reached", "not_requested", { lastAssessment: "Attempt limit reached." }),
      pending: execution("pending")
    }
  };

  writeHandoff(paths, state, document);
  const handoff = fs.readFileSync(paths.handoffFile, "utf8");
  const morning = fs.readFileSync(path.join(directory, "MORNING_REPORT.md"), "utf8");
  assert.equal(morning, handoff);
  for (const section of ["Provisionally complete", "Human accepted", "Rejected", "Blocked or dependency-blocked", "Limit reached", "Decisions and reviewer evidence", "Important decisions", "Known problems and risks", "Next actions", "Dependencies and downstream impact", "Verification evidence", "Changed paths", "Resource limits", "Checkpoints", "Acceptance checklist"]) {
    assert.match(handoff, new RegExp(`## ${section}`));
  }
  assert.match(handoff, /node \/installed\/night-mode\/scripts\/night-mode accept .*--task awaiting/);
  assert.match(handoff, /node \/installed\/night-mode\/scripts\/night-mode reject .*--task awaiting/);
  assert.match(handoff, /--cwd/);
  assert.match(handoff, /--state-dir/);
  assert.match(handoff, /preserved checkpoint `ghi789`/);
  assert.match(handoff, /preexisting\.txt/);
  assert.match(handoff, /workflow\.txt/);
  assert.match(handoff, /Keep machine state out of checkpoints/);
  assert.match(handoff, /External dependency unavailable/);
  if (previousCommand === undefined) delete process.env.CODEX_WORKFLOW_COMMAND;
  else process.env.CODEX_WORKFLOW_COMMAND = previousCommand;
});
