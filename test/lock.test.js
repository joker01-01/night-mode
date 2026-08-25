const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { acquireLock, releaseLock } = require("../dist/lock.js");
const { workflowPaths, writeJsonAtomic } = require("../dist/storage.js");

test("workflow lock rejects an active owner and requires explicit stale recovery", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-lock-"));
  const paths = workflowPaths(directory);
  acquireLock(paths, false);
  const metadata = JSON.parse(fs.readFileSync(paths.lockFile, "utf8"));
  assert.equal(metadata.target, directory);
  assert.equal(typeof metadata.runId, "string");
  assert.equal(typeof metadata.commandContext, "string");
  assert.throws(() => acquireLock(paths, false), /active/);
  releaseLock(paths);
  fs.mkdirSync(paths.lockDir, { recursive: true });
  writeJsonAtomic(paths.lockFile, { pid: 999999, acquiredAt: "2020-01-01T00:00:00.000Z", cwd: directory });
  assert.throws(() => acquireLock(paths, false), /stale or invalid/);
  assert.doesNotThrow(() => acquireLock(paths, true));
  releaseLock(paths);
  assert.equal(fs.existsSync(paths.lockDir), false);
});
