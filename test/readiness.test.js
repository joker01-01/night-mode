const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { assessReadiness } = require("../dist/readiness.js");
const { workflowPaths } = require("../dist/storage.js");
const { loadTaskDocument } = require("../dist/tasks.js");
const { runWorkflow } = require("../dist/workflow.js");

function repository(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  childProcess.execFileSync("git", ["init"], { cwd: directory, stdio: "ignore" });
  return directory;
}

function taskDocument(directory, additions = {}) {
  const file = path.join(directory, "workflow.tasks.json");
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 2,
    ...additions,
    tasks: additions.tasks ?? [{ id: "one", title: "One", objective: "Do one thing", acceptanceCriteria: ["It works"], verification: [`"${process.execPath}" -e "process.exit(0)"`], dependsOn: [] }]
  }));
  return file;
}

test("readiness reports the backward-compatible automation baseline honestly", async () => {
  const directory = repository("night-readiness-base-");
  const taskFile = taskDocument(directory);
  const loaded = loadTaskDocument(taskFile);
  const paths = workflowPaths(directory);
  const assessment = await assessReadiness(paths, loaded.document, loaded.file, 2);
  assert.equal(assessment.level, 2);
  assert.equal(assessment.ready, true);
  assert.equal(assessment.checks.some((check) => check.code === "repository_assumptions" && check.status === "warning"), true);
  assert.equal(fs.existsSync(paths.readinessFile), true);
  assert.match(fs.readFileSync(paths.readinessReportFile, "utf8"), /Level: \*\*2 \/ 4\*\*.*Gate: \*\*PASS\*\*/s);
});

test("explicit bootstrap and user-path evidence declarations reach level four", async () => {
  const directory = repository("night-readiness-four-");
  const taskFile = taskDocument(directory, {
    readiness: {
      requiredCommands: [],
      requiredEnvironment: [],
      network: "none",
      bootstrap: { installCommand: "npm ci", checkCommand: `"${process.execPath}" -e "process.exit(0)"` }
    },
    tasks: [{
      id: "one",
      title: "One",
      objective: "Do one thing",
      acceptanceCriteria: ["It works"],
      verification: [`"${process.execPath}" -e "process.exit(0)"`],
      dependsOn: [],
      qualityGates: [{ id: "user-smoke", kind: "user_path", command: `"${process.execPath}" -e "process.exit(0)"`, evidencePaths: ["artifacts/user-smoke.json"] }]
    }]
  });
  const loaded = loadTaskDocument(taskFile);
  const assessment = await assessReadiness(workflowPaths(directory), loaded.document, loaded.file, 4);
  assert.equal(assessment.level, 4);
  assert.equal(assessment.ready, true);
  assert.equal(assessment.bootstrapCheck.exitCode, 0);
});

test("missing declared prerequisites block readiness without recording secret values", async () => {
  const directory = repository("night-readiness-blocked-");
  const variable = "NIGHT_MODE_TEST_SECRET_THAT_MUST_NOT_EXIST";
  delete process.env[variable];
  const taskFile = taskDocument(directory, { readiness: { requiredCommands: [], requiredEnvironment: [variable], network: "optional" } });
  const loaded = loadTaskDocument(taskFile);
  const paths = workflowPaths(directory);
  const assessment = await assessReadiness(paths, loaded.document, loaded.file, 2);
  assert.equal(assessment.level, 0);
  assert.equal(assessment.ready, false);
  const serialized = fs.readFileSync(paths.readinessFile, "utf8");
  assert.match(serialized, new RegExp(variable));
  assert.doesNotMatch(serialized, /secret-value=/);
});

test("a bootstrap health check that mutates the repository is blocked", async () => {
  const directory = repository("night-readiness-bootstrap-mutation-");
  const taskFile = taskDocument(directory, {
    readiness: {
      requiredCommands: [],
      requiredEnvironment: [],
      network: "none",
      bootstrap: { installCommand: "npm ci", checkCommand: `"${process.execPath}" -e "require('fs').writeFileSync('bootstrap-side-effect.txt','changed')"` }
    }
  });
  const loaded = loadTaskDocument(taskFile);
  const assessment = await assessReadiness(workflowPaths(directory), loaded.document, loaded.file, 2);
  assert.equal(assessment.ready, false);
  assert.equal(assessment.level, 0);
  assert.equal(assessment.checks.some((check) => check.code === "bootstrap_mutated_repository" && check.status === "blocker"), true);
});

test("Night Shift enforces the selected readiness level before starting Codex", async () => {
  const directory = repository("night-readiness-gate-");
  const taskFile = taskDocument(directory);
  await assert.rejects(() => runWorkflow({
    cwd: directory,
    taskFile,
    mode: "night",
    resume: false,
    maxAttempts: 1,
    maxTasks: 1,
    maxStagnantAttempts: 2,
    idleTimeoutSeconds: 1,
    hardTimeoutSeconds: 1,
    checkpoint: false,
    allowDirty: true,
    reclaimStaleLock: false,
    codexBin: "must-not-run",
    totalRuntimeSeconds: 60,
    minReadinessLevel: 4
  }), /Night readiness gate failed at level 2; required level 4/);
  const paths = workflowPaths(directory);
  assert.equal(fs.existsSync(paths.readinessReportFile), true);
  assert.equal(fs.existsSync(paths.stateFile), false);
});

test("readiness CLI writes reports and returns a truthful gate result", () => {
  const directory = repository("night-readiness-cli-");
  const taskFile = taskDocument(directory);
  const result = childProcess.spawnSync(process.execPath, [path.join(__dirname, "..", "dist", "index.js"), "readiness", "--cwd", directory, "--tasks", taskFile, "--min-readiness", "2"], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Readiness level 2\/4; required 2\/4; PASS/);
  assert.equal(fs.existsSync(workflowPaths(directory).readinessReportFile), true);
});
