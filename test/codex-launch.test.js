const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { resolveCodexInvocation } = require("../dist/codex.js");

test("Windows launches a global npm Codex installation through Node instead of a shell shim", () => {
  const globalBin = "C:\\Tools\\node_global";
  const cliScript = path.win32.join(globalBin, "node_modules", "@openai", "codex", "bin", "codex.js");
  const invocation = resolveCodexInvocation({
    codexBin: "codex",
    args: ["exec", "--sandbox", "workspace-write"],
    platform: "win32",
    pathValue: `${globalBin};C:\\Windows\\System32`,
    nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    exists: (file) => file === cliScript
  });

  assert.deepEqual(invocation, {
    command: "C:\\Program Files\\nodejs\\node.exe",
    args: [cliScript, "exec", "--sandbox", "workspace-write"]
  });
});
