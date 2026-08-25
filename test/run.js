const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const testDirectory = __dirname;
const testFiles = fs.readdirSync(testDirectory)
  .filter((file) => file.endsWith(".test.js"))
  .sort()
  .map((file) => path.join(testDirectory, file));

const result = childProcess.spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
  windowsHide: true
});
process.exitCode = result.status ?? 1;
