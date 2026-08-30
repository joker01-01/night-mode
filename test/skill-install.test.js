const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const sourceRoot = path.join(__dirname, "..");

function copyDistribution(target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of [".agents", "SKILL.md", "README.md", "package.json", "package-lock.json", "tsconfig.json", "src", "scripts", "workflow.tasks.example.json"]) {
    fs.cpSync(path.join(sourceRoot, entry), path.join(target, entry), { recursive: true });
  }
}

function packageManagerShim(directory) {
  const shimScript = path.join(directory, "package-manager-shim.js");
  fs.writeFileSync(shimScript, `
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write("smoke-test-package-manager\\n");
  process.exit(0);
}
if (args[0] === "ci" || args[0] === "install") {
  fs.cpSync(process.env.NIGHT_MODE_TEST_NODE_MODULES, path.join(process.cwd(), "node_modules"), { recursive: true });
  process.exit(0);
}
if (args[0] === "run" && args[1] === "build") {
  const tsc = path.join(process.cwd(), "node_modules", "typescript", "bin", "tsc");
  const result = childProcess.spawnSync(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: process.cwd(), stdio: "inherit" });
  process.exit(result.status ?? 1);
}
process.stderr.write("unsupported package-manager arguments: " + args.join(" ") + "\\n");
process.exit(2);
`);

  const bin = path.join(directory, "bin");
  fs.mkdirSync(bin);
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(bin, "npm.cmd"), `@echo off\r\n"${process.execPath}" "${shimScript}" %*\r\n`);
  } else {
    const npm = path.join(bin, "npm");
    fs.writeFileSync(npm, `#!/usr/bin/env node\nrequire(${JSON.stringify(shimScript)});\n`);
    fs.chmodSync(npm, 0o755);
  }
  return bin;
}

function fakeCodex(directory) {
  const script = path.join(directory, "fake-codex.js");
  const proposal = {
    outcomeSummary: "The clean-install smoke workflow completed.",
    importantDecisions: ["Use the installed wrapper for every command."],
    knownProblems: [],
    verificationEvidence: ["The declared command passed."],
    nextActions: ["Inspect the handoff."],
    humanAcceptanceActions: ["Accept or reject the provisional result."]
  };
  const work = { status: "COMPLETE", assessment: "Smoke task complete.", evidence: ["Wrapper launched the worker."], nextStep: "Review.", blockerReason: "", projectStateProposal: proposal };
  const review = { decision: "SHIP", assessment: "Smoke task is ready.", feedback: "Ready for human acceptance.", evidence: ["Wrapper launched the read-only reviewer."], projectStateReview: { decision: "APPROVE", proposal, feedback: "Continuity state is accurate." } };
  fs.writeFileSync(script, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const output = args[args.indexOf("--output-last-message") + 1];
const sandbox = args[args.indexOf("--sandbox") + 1];
fs.writeFileSync(output, JSON.stringify(sandbox === "workspace-write" ? ${JSON.stringify(work)} : ${JSON.stringify(review)}));
`);
  if (process.platform !== "win32") {
    fs.chmodSync(script, 0o755);
    return script;
  }
  const launcher = path.join(directory, "fake-codex.cmd");
  fs.writeFileSync(launcher, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  return launcher;
}

function runNode(args, options) {
  return childProcess.spawnSync(process.execPath, args, { encoding: "utf8", windowsHide: true, ...options });
}

test("a clean user-skill copy bootstraps, builds, runs Interactive, and prints executable handoff commands", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "night-mode-install-smoke-"));
  const installed = path.join(temporary, "night-mode");
  copyDistribution(installed);
  assert.equal(fs.existsSync(path.join(installed, "node_modules")), false);
  assert.equal(fs.existsSync(path.join(installed, "dist")), false);

  const shimBin = packageManagerShim(temporary);
  const env = {
    ...process.env,
    PATH: [shimBin, path.dirname(process.execPath), process.env.PATH ?? ""].join(path.delimiter),
    NIGHT_MODE_TEST_NODE_MODULES: path.join(sourceRoot, "node_modules")
  };
  const wrapper = path.join(installed, "scripts", "night-mode");
  const help = runNode([wrapper, "help"], { cwd: installed, env });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /Codex Development Workflow/);
  assert.equal(fs.existsSync(path.join(installed, "node_modules", "typescript", "bin", "tsc")), true);
  assert.equal(fs.existsSync(path.join(installed, "dist", "index.js")), true);

  const target = path.join(temporary, "target");
  fs.mkdirSync(target);
  childProcess.execFileSync("git", ["init"], { cwd: target, stdio: "ignore" });
  const taskFile = path.join(target, "workflow.tasks.json");
  const verification = `"${process.execPath}" -e "process.exit(0)"`;
  fs.writeFileSync(taskFile, JSON.stringify({ schemaVersion: 2, tasks: [{ id: "smoke", title: "Smoke", objective: "Prove the installed wrapper works", acceptanceCriteria: ["The full controller path completes"], verification: [verification], dependsOn: [] }] }));
  childProcess.execFileSync("git", ["add", "workflow.tasks.json"], { cwd: target, stdio: "ignore" });
  childProcess.execFileSync("git", ["-c", "user.name=Night Mode Smoke", "-c", "user.email=smoke@example.invalid", "commit", "-m", "smoke fixture"], { cwd: target, stdio: "ignore" });

  const codex = fakeCodex(temporary);
  const run = runNode([wrapper, "run", "--cwd", target, "--tasks", "workflow.tasks.json", "--task", "smoke", "--codex-bin", codex, "--max-attempts", "1", "--idle-timeout", "5", "--hard-timeout", "15"], { cwd: target, env });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /Workflow needs_review: awaiting_human_acceptance/);

  const stateFile = path.join(target, ".codex", "workflow", "run-state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(state.tasks.smoke.automationStatus, "provisionally_complete");
  const handoff = fs.readFileSync(path.join(target, ".codex", "workflow", "HANDOFF.md"), "utf8");
  assert.match(handoff, new RegExp(wrapper.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(handoff, /accept .*--cwd .*--state-dir .*--task smoke/);

  const accept = runNode([wrapper, "accept", "--cwd", target, "--task", "smoke"], { cwd: target, env });
  assert.equal(accept.status, 0, accept.stderr || accept.stdout);
  const accepted = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(accepted.tasks.smoke.humanAcceptanceStatus, "accepted");
  assert.equal(accepted.status, "completed");
});
