const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { assertTaskDocumentUnchanged, loadTaskDocument, validateTaskDocument, validateTaskGraph } = require("../dist/tasks.js");

const verification = ["node -e \"process.exit(0)\""];

test("task document validates and detects a mid-run requirements mutation", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-tasks-"));
  const taskFile = path.join(directory, "tasks.json");
  fs.writeFileSync(taskFile, JSON.stringify({ schemaVersion: 2, tasks: [{ id: "one", title: "One", objective: "Do one thing", acceptanceCriteria: ["It works"], verification, dependsOn: [] }] }));
  const loaded = loadTaskDocument(taskFile);
  assert.equal(loaded.document.tasks[0].id, "one");
  assert.doesNotThrow(() => assertTaskDocumentUnchanged(taskFile, loaded.hash));
  fs.writeFileSync(taskFile, JSON.stringify({ schemaVersion: 2, tasks: [{ id: "one", title: "One", objective: "Changed requirement", acceptanceCriteria: ["It works"], verification, dependsOn: [] }] }));
  assert.throws(() => assertTaskDocumentUnchanged(taskFile, loaded.hash), /immutable/);
  assert.throws(() => validateTaskDocument({ schemaVersion: 2, tasks: [{ id: "one", title: "", objective: "x", acceptanceCriteria: ["x"], verification, dependsOn: [] }] }), /requires non-empty/);
});

test("task document accepts a UTF-8 BOM written by Windows PowerShell", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-tasks-bom-"));
  const taskFile = path.join(directory, "tasks.json");
  fs.writeFileSync(taskFile, `\uFEFF${JSON.stringify({ schemaVersion: 2, tasks: [{ id: "one", title: "One", objective: "Do one thing", acceptanceCriteria: ["It works"], verification, dependsOn: [] }] })}`, "utf8");

  assert.equal(loadTaskDocument(taskFile).document.tasks[0].id, "one");
});

test("task schema v1 is rejected with an actionable migration message", () => {
  assert.throws(() => validateTaskDocument({ schemaVersion: 1, tasks: [] }), /schemaVersion 1.*schemaVersion 2.*verification.*dependsOn/);
});

test("task schema v2 requires acceptance, verification, and explicit dependencies", () => {
  const base = { schemaVersion: 2, tasks: [{ id: "one", title: "One", objective: "Do one thing", acceptanceCriteria: ["It works"], verification, dependsOn: [] }] };
  assert.doesNotThrow(() => validateTaskDocument(base));
  for (const [field, value] of [["acceptanceCriteria", []], ["verification", []], ["dependsOn", undefined]]) {
    const task = { ...base.tasks[0], [field]: value };
    assert.throws(() => validateTaskDocument({ schemaVersion: 2, tasks: [task] }), new RegExp(field));
  }
});

test("task dependency graph rejects unknown, self, duplicate, and cyclic dependencies", () => {
  const task = (id, dependsOn) => ({ id, title: id, objective: id, acceptanceCriteria: ["done"], verification, dependsOn });
  assert.throws(() => validateTaskGraph([task("one", ["missing"])]), /unknown task/);
  assert.throws(() => validateTaskGraph([task("one", ["one"])]), /cannot depend on itself/);
  assert.throws(() => validateTaskGraph([task("one", []), task("one", [])]), /duplicate task IDs/);
  assert.throws(() => validateTaskGraph([task("one", ["two", "two"]), task("two", [])]), /duplicate dependency/);
  assert.throws(() => validateTaskGraph([task("one", ["two"]), task("two", ["one"])]), /cycle/);
  assert.doesNotThrow(() => validateTaskGraph([task("one", []), task("two", ["one"]), task("three", ["one"])]));
});
