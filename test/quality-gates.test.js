const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { workflowPaths } = require("../dist/storage.js");
const { runValidation } = require("../dist/validation.js");

function task(command, evidencePath) {
  return {
    id: "qa",
    title: "QA",
    objective: "Exercise a user path",
    acceptanceCriteria: ["Evidence exists"],
    verification: [`"${process.execPath}" -e "process.exit(0)"`],
    dependsOn: [],
    qualityGates: [{ id: "user-smoke", kind: "user_path", command, evidencePaths: [evidencePath] }]
  };
}

test("quality gates require regular-file evidence and record its hash", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "night-quality-evidence-"));
  fs.mkdirSync(path.join(directory, "artifacts"));
  const command = `"${process.execPath}" -e "require('fs').writeFileSync('artifacts/user-smoke.bin', Buffer.from([0,1,2,3]))"`;
  const validation = await runValidation(workflowPaths(directory), task(command, "artifacts/user-smoke.bin"), 1, 5);
  assert.equal(validation.status, "passed");
  const gate = validation.qualityGates[0];
  assert.equal(gate.status, "passed");
  assert.equal(gate.evidence[0].fresh, true);
  assert.equal(gate.evidence[0].bytes, 4);
  assert.match(gate.evidence[0].sha256, /^[a-f0-9]{64}$/);
});

test("a zero-exit quality command still fails when declared evidence is missing", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "night-quality-missing-"));
  const command = `"${process.execPath}" -e "process.exit(0)"`;
  const validation = await runValidation(workflowPaths(directory), task(command, "artifacts/missing.json"), 1, 5);
  assert.equal(validation.status, "failed");
  assert.equal(validation.qualityGates[0].status, "failed");
  assert.match(validation.qualityGates[0].failure, /did not produce fresh regular-file evidence/);
});

test("pre-existing evidence must be refreshed by the current quality command", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "night-quality-stale-"));
  fs.mkdirSync(path.join(directory, "artifacts"));
  fs.writeFileSync(path.join(directory, "artifacts", "stale.json"), "old evidence\n");
  const command = `"${process.execPath}" -e "process.exit(0)"`;
  const validation = await runValidation(workflowPaths(directory), task(command, "artifacts/stale.json"), 1, 5);
  assert.equal(validation.status, "failed");
  assert.equal(validation.qualityGates[0].evidence[0].fresh, false);
  assert.match(validation.qualityGates[0].evidence[0].failure, /not created or refreshed/);
});

test("quality evidence cannot be placed in a custom controller state directory", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "night-quality-state-dir-"));
  const command = `"${process.execPath}" -e "const fs=require('fs');fs.mkdirSync('machine-state',{recursive:true});fs.writeFileSync('machine-state/fake.json','fake')"`;
  const validation = await runValidation(workflowPaths(directory, "machine-state"), task(command, "machine-state/fake.json"), 1, 5);
  assert.equal(validation.status, "failed");
  assert.match(validation.qualityGates[0].evidence[0].failure, /controller-owned state directory/);
});
