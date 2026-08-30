const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { parseReviewResult, parseWorkResult, writeSchemas } = require("../dist/codex.js");
const { workflowPaths } = require("../dist/storage.js");

test("worker and reviewer contracts reject incomplete self-reported completion", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-contracts-"));
  const workFile = path.join(directory, "work.json");
  const reviewFile = path.join(directory, "review.json");
  const proposal = { outcomeSummary: "Ready.", importantDecisions: [], knownProblems: [], verificationEvidence: ["npm test passed"], nextActions: ["Await review."], humanAcceptanceActions: ["Accept after inspection."] };
  fs.writeFileSync(workFile, JSON.stringify({ status: "COMPLETE", assessment: "Implemented", evidence: ["npm test passed"], nextStep: "Await review", blockerReason: "", projectStateProposal: proposal }));
  fs.writeFileSync(reviewFile, JSON.stringify({ decision: "SHIP", assessment: "Criteria inspected", feedback: "Ready", evidence: ["Diff and tests inspected"], projectStateReview: { decision: "APPROVE", proposal, feedback: "Approved." } }));
  assert.equal(parseWorkResult(workFile).status, "COMPLETE");
  assert.equal(parseReviewResult(reviewFile).decision, "SHIP");
  fs.writeFileSync(workFile, JSON.stringify({ status: "BLOCKED", assessment: "Blocked", evidence: ["No token"], nextStep: "Ask user", blockerReason: "" }));
  assert.throws(() => parseWorkResult(workFile), /blockerReason/);
  fs.writeFileSync(reviewFile, JSON.stringify({ decision: "SHIP", assessment: "Looks good", evidence: ["No feedback field"] }));
  assert.throws(() => parseReviewResult(reviewFile), /review contract/);
});

test("worker output schema declares blockerReason as required for strict structured output", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-schemas-"));
  const paths = workflowPaths(directory);
  writeSchemas(paths);
  const schema = JSON.parse(fs.readFileSync(paths.workSchemaFile, "utf8"));

  assert.ok(schema.required.includes("blockerReason"));
  assert.ok(schema.required.includes("projectStateProposal"));
  assert.ok(schema.properties.projectStateProposal.required.includes("memoryCandidates"));
  assert.equal(schema.properties.projectStateProposal.properties.memoryCandidates.items.additionalProperties, false);
});

test("worker and reviewer contracts can carry structured project-state proposals", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-project-state-contracts-"));
  const workFile = path.join(directory, "work.json");
  const reviewFile = path.join(directory, "review.json");
  const proposal = {
    outcomeSummary: "Task is ready for review.",
    importantDecisions: [],
    knownProblems: [],
    verificationEvidence: ["node --test"],
    nextActions: ["Await human inspection."],
    humanAcceptanceActions: ["Accept after inspection."]
  };
  fs.writeFileSync(workFile, JSON.stringify({ status: "COMPLETE", assessment: "Implemented", evidence: ["proof"], nextStep: "Review", blockerReason: "", projectStateProposal: proposal }));
  fs.writeFileSync(reviewFile, JSON.stringify({ decision: "SHIP", assessment: "Criteria inspected", feedback: "Ready", evidence: ["Diff inspected"], projectStateReview: { decision: "APPROVE", proposal, feedback: "Approved." } }));
  assert.equal(parseWorkResult(workFile).projectStateProposal.outcomeSummary, proposal.outcomeSummary);
  assert.equal(parseReviewResult(reviewFile).projectStateReview.decision, "APPROVE");
  fs.writeFileSync(workFile, JSON.stringify({ status: "COMPLETE", assessment: "Implemented", evidence: ["proof"], nextStep: "Review", blockerReason: "", projectStateProposal: { ...proposal, outcomeSummary: "" } }));
  assert.throws(() => parseWorkResult(workFile), /outcomeSummary/);
});
