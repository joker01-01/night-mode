const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertAutomationStatusTransition,
  assertHumanAcceptanceTransition,
  assertProjectStateProposal,
  assertProjectStateReview,
  assertRunStatusTransition,
  assertTaskStateTransition,
  taskOutcome
} = require("../dist/state.js");

test("task state keeps automation and human acceptance transitions separate", () => {
  assert.equal(taskOutcome({ automationStatus: "provisionally_complete", humanAcceptanceStatus: "awaiting_human_acceptance" }), "provisionally_complete");
  assert.equal(taskOutcome({ automationStatus: "provisionally_complete", humanAcceptanceStatus: "accepted" }), "completed");
  assert.equal(taskOutcome({ automationStatus: "pending", humanAcceptanceStatus: "rejected" }), "rejected");
  assert.doesNotThrow(() => assertTaskStateTransition(
    { automationStatus: "running", humanAcceptanceStatus: "not_requested" },
    { automationStatus: "provisionally_complete", humanAcceptanceStatus: "awaiting_human_acceptance" }
  ));
  assert.doesNotThrow(() => assertTaskStateTransition(
    { automationStatus: "provisionally_complete", humanAcceptanceStatus: "awaiting_human_acceptance" },
    { automationStatus: "provisionally_complete", humanAcceptanceStatus: "accepted" }
  ));
  assert.doesNotThrow(() => assertTaskStateTransition(
    { automationStatus: "provisionally_complete", humanAcceptanceStatus: "awaiting_human_acceptance" },
    { automationStatus: "pending", humanAcceptanceStatus: "rejected" }
  ));
  assert.throws(() => assertTaskStateTransition(
    { automationStatus: "pending", humanAcceptanceStatus: "not_requested" },
    { automationStatus: "provisionally_complete", humanAcceptanceStatus: "accepted" }
  ), /Invalid automation status transition|provisionally complete/);
  assert.throws(() => assertTaskStateTransition(
    { automationStatus: "running", humanAcceptanceStatus: "not_requested" },
    { automationStatus: "pending", humanAcceptanceStatus: "accepted" }
  ), /Invalid automation status transition|Human acceptance requires/);
});

test("state transition tables reject impossible terminal transitions", () => {
  assert.throws(() => assertAutomationStatusTransition("blocked", "running"), /Invalid automation status transition/);
  assert.throws(() => assertHumanAcceptanceTransition("accepted", "rejected"), /Invalid human-acceptance status transition/);
  assert.throws(() => assertRunStatusTransition("completed", "running"), /Invalid run status transition/);
  assert.doesNotThrow(() => assertAutomationStatusTransition("limit_reached", "pending"));
  assert.doesNotThrow(() => assertRunStatusTransition("limit_reached", "running"));
});

test("structured project-state proposals and reviewer decisions are validated", () => {
  const proposal = {
    outcomeSummary: "Task is ready for review.",
    importantDecisions: [],
    knownProblems: ["One known limitation."],
    verificationEvidence: ["npm test"],
    nextActions: ["Ask the user to inspect the diff."],
    humanAcceptanceActions: ["Run accept after inspection."]
  };
  assert.doesNotThrow(() => assertProjectStateProposal(proposal));
  assert.doesNotThrow(() => assertProjectStateReview({ decision: "APPROVE", proposal, feedback: "Approved." }));
  assert.throws(() => assertProjectStateProposal({ ...proposal, outcomeSummary: "" }), /outcomeSummary/);
  assert.throws(() => assertProjectStateReview({ decision: "SHIP", proposal, feedback: "Approved." }), /APPROVE or CORRECT/);
});
