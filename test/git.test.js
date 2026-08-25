const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { gitSnapshot, preflightGit } = require("../dist/git.js");

function repository() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-git-"));
  childProcess.execFileSync("git", ["init"], { cwd: directory, stdio: "ignore" });
  fs.writeFileSync(path.join(directory, "tracked.txt"), "tracked\n");
  childProcess.execFileSync("git", ["add", "tracked.txt"], { cwd: directory, stdio: "ignore" });
  childProcess.execFileSync("git", ["-c", "user.name=Workflow Test", "-c", "user.email=workflow@example.invalid", "commit", "-m", "initial"], { cwd: directory, stdio: "ignore" });
  return directory;
}

test("Git preflight rejects a non-repository target", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-non-git-"));
  assert.equal(gitSnapshot(directory).available, false);
  assert.throws(() => preflightGit(directory, "interactive", false), /Git preflight failed.*(working tree|not a git repository)/i);
});

test("Git preflight captures a clean baseline and permits checkpoints", () => {
  const directory = repository();
  fs.mkdirSync(path.join(directory, ".codex", "workflow"), { recursive: true });
  fs.writeFileSync(path.join(directory, ".codex", "workflow", "machine-state.json"), "machine state\n");
  const snapshot = gitSnapshot(directory);
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.clean, true);
  assert.equal(snapshot.initialChangedPaths.length, 0);
  assert.match(snapshot.initialCommit, /^[a-f0-9]{40}$/);
  assert.match(snapshot.representationHash, /^[a-f0-9]{64}$/);
  const result = preflightGit(directory, "night", false);
  assert.equal(result.clean, true);
  assert.equal(result.checkpointAllowed, true);
  assert.deepEqual(result.warnings, []);
});

test("dirty worktrees warn in Interactive and reject Night unless explicitly allowed", () => {
  const directory = repository();
  fs.writeFileSync(path.join(directory, "preexisting.txt"), "human change\n");
  const snapshot = gitSnapshot(directory);
  assert.equal(snapshot.clean, false);
  assert.deepEqual(snapshot.initialChangedPaths, ["preexisting.txt"]);

  const interactive = preflightGit(directory, "interactive", false);
  assert.equal(interactive.checkpointAllowed, false);
  assert.match(interactive.warnings[0], /Interactive mode.*dirty/);
  assert.throws(() => preflightGit(directory, "night", false), /Night Shift.*dirty.*--allow-dirty/);

  const allowedNight = preflightGit(directory, "night", true);
  assert.equal(allowedNight.clean, false);
  assert.equal(allowedNight.checkpointAllowed, false);
  assert.match(allowedNight.warnings[0], /--allow-dirty/);
  assert.equal(allowedNight.baseline.initialChangedPaths[0], "preexisting.txt");
});

test("Git integration contains no destructive recovery commands", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "git.ts"), "utf8");
  assert.doesNotMatch(source, /\bgit\s+(reset|clean|checkout|rebase|fetch)\b/);
});
