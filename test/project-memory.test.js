const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  addProjectMemory,
  archiveProjectMemory,
  formatProjectMemoryContext,
  promoteProjectMemoryCandidates,
  readProjectMemory,
  revalidateProjectMemory,
  selectRelevantProjectMemories
} = require("../dist/project-memory.js");
const { workflowPaths } = require("../dist/storage.js");
const { runWorkflow } = require("../dist/workflow.js");

function repository(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  childProcess.execFileSync("git", ["init"], { cwd: directory, stdio: "ignore" });
  return directory;
}

function candidate(overrides = {}) {
  return {
    kind: "learning",
    statement: "The controller uses evidence-backed project memory.",
    tags: ["memory", "controller"],
    citations: [{ path: "docs/architecture.md", startLine: 2, endLine: 3 }],
    ...overrides
  };
}

function fixture(prefix = "night-project-memory-") {
  const directory = repository(prefix);
  fs.mkdirSync(path.join(directory, "docs"));
  fs.writeFileSync(path.join(directory, "docs", "architecture.md"), "Architecture\nMemory facts require citations.\nOnly validated facts are injected.\nEnd.\n");
  return { directory, paths: workflowPaths(directory) };
}

function task(overrides = {}) {
  return {
    id: "memory-task",
    title: "Improve project memory",
    objective: "Make controller memory validation reliable",
    acceptanceCriteria: ["Memory facts have citations"],
    verification: [],
    dependsOn: [],
    ...overrides
  };
}

test("reviewer-approved memory captures exact citation evidence and deduplicates", () => {
  const { paths } = fixture();
  const first = promoteProjectMemoryCandidates(paths, [candidate()], "run-one", "task-one");
  const second = promoteProjectMemoryCandidates(paths, [candidate()], "run-two", "task-two");
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  const store = readProjectMemory(paths);
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].status, "active");
  assert.equal(store.entries[0].citations[0].text, "Memory facts require citations.\nOnly validated facts are injected.");
  assert.match(store.entries[0].citations[0].textSha256, /^[a-f0-9]{64}$/);
  assert.match(fs.readFileSync(paths.projectMemoryReportFile, "utf8"), /Only active, task-relevant entries are injected/);
});

test("citation revalidation relocates uniquely moved text and disables changed or missing evidence", () => {
  const { directory, paths } = fixture();
  const entry = addProjectMemory(paths, candidate());
  fs.writeFileSync(path.join(directory, "docs", "architecture.md"), "New heading\nArchitecture\nMemory facts require citations.\nOnly validated facts are injected.\nEnd.\n");
  let store = revalidateProjectMemory(paths);
  assert.equal(store.entries[0].status, "active");
  assert.deepEqual([store.entries[0].citations[0].startLine, store.entries[0].citations[0].endLine], [3, 4]);

  fs.writeFileSync(path.join(directory, "docs", "architecture.md"), "New heading\nArchitecture\nMemory facts no longer require citations.\nOnly validated facts are injected.\nEnd.\n");
  store = revalidateProjectMemory(paths);
  assert.equal(store.entries[0].status, "stale");
  assert.equal(selectRelevantProjectMemories(paths, task()).length, 0);

  fs.rmSync(path.join(directory, "docs", "architecture.md"));
  store = revalidateProjectMemory(paths);
  assert.equal(store.entries.find((item) => item.id === entry.id).status, "missing");
});

test("retention expires unused memory but relevant use resets the window", () => {
  const { paths } = fixture();
  const entry = addProjectMemory(paths, candidate(), 28);
  const created = Date.parse(entry.createdAt);
  const day27 = new Date(created + 27 * 86_400_000).toISOString();
  const day40 = new Date(created + 40 * 86_400_000).toISOString();
  const day56 = new Date(created + 56 * 86_400_000).toISOString();
  assert.equal(selectRelevantProjectMemories(paths, task(), 8, day27).length, 1);
  assert.equal(revalidateProjectMemory(paths, day40).entries[0].status, "active");
  assert.equal(revalidateProjectMemory(paths, day56).entries[0].status, "expired");
  assert.equal(selectRelevantProjectMemories(paths, task(), 8, day56).length, 0);
});

test("selection injects only relevant active facts while global constraints remain visible", () => {
  const { paths } = fixture();
  addProjectMemory(paths, candidate());
  addProjectMemory(paths, candidate({
    statement: "Release packaging uses signed archives.",
    tags: ["release", "packaging"],
    citations: [{ path: "docs/architecture.md", startLine: 1, endLine: 1 }]
  }));
  addProjectMemory(paths, candidate({
    kind: "constraint",
    statement: "Never bypass repository verification.",
    tags: ["safety"],
    citations: [{ path: "docs/architecture.md", startLine: 4, endLine: 4 }]
  }));
  const selected = selectRelevantProjectMemories(paths, task());
  assert.deepEqual(new Set(selected.map((entry) => entry.statement)), new Set([
    "The controller uses evidence-backed project memory.",
    "Never bypass repository verification."
  ]));
  assert.doesNotMatch(formatProjectMemoryContext(selected), /signed archives/);
  assert.match(formatProjectMemoryContext(selected), /sha256=/);
});

test("archived memory is retained for audit and excluded from future context", () => {
  const { paths } = fixture();
  const entry = addProjectMemory(paths, candidate());
  archiveProjectMemory(paths, entry.id, "Superseded by a newer decision.");
  const store = revalidateProjectMemory(paths);
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].status, "archived");
  assert.equal(store.entries[0].archiveReason, "Superseded by a newer decision.");
  assert.equal(selectRelevantProjectMemories(paths, task()).length, 0);
});

test("citation capture rejects traversal, controller state, secrets, symlinks, and oversized ranges", () => {
  const { directory, paths } = fixture();
  fs.writeFileSync(path.join(directory, ".env"), "TOKEN=do-not-store\n");
  fs.writeFileSync(path.join(directory, "outside-target.md"), "target\n");
  fs.symlinkSync(path.join(directory, "outside-target.md"), path.join(directory, "docs", "linked.md"));
  fs.mkdirSync(paths.stateDir, { recursive: true });
  fs.writeFileSync(path.join(paths.stateDir, "managed.md"), "managed\n");
  fs.writeFileSync(path.join(directory, "docs", "oversized.md"), "x".repeat(5 * 1024 * 1024 + 1));

  assert.throws(() => addProjectMemory(paths, candidate({ citations: [{ path: "../outside.md", startLine: 1, endLine: 1 }] })), /escapes the repository/);
  assert.throws(() => addProjectMemory(paths, candidate({ citations: [{ path: ".env", startLine: 1, endLine: 1 }] })), /secret-like/);
  assert.throws(() => addProjectMemory(paths, candidate({ citations: [{ path: ".codex/workflow/managed.md", startLine: 1, endLine: 1 }] })), /controller-managed/);
  assert.throws(() => addProjectMemory(paths, candidate({ citations: [{ path: "docs/linked.md", startLine: 1, endLine: 1 }] })), /non-symlink/);
  assert.throws(() => addProjectMemory(paths, candidate({ citations: [{ path: "docs/architecture.md", startLine: 1, endLine: 51 }] })), /limited to 50 lines/);
  assert.throws(() => addProjectMemory(paths, candidate({ citations: [{ path: "docs/oversized.md", startLine: 1, endLine: 1 }] })), /source exceeds/);
  assert.throws(() => addProjectMemory(paths, candidate({ statement: "x".repeat(1_001) })), /limited to 1000 characters/);
  assert.throws(() => addProjectMemory(paths, candidate({ citations: Array.from({ length: 6 }, () => ({ path: "docs/architecture.md", startLine: 1, endLine: 1 })) })), /requires 1-5 citations/);
});

test("memory CLI adds, lists, validates, and archives without deleting the record", () => {
  const { directory, paths } = fixture("night-project-memory-cli-");
  const cli = path.join(__dirname, "..", "dist", "index.js");
  const run = (...argumentsList) => childProcess.spawnSync(process.execPath, [cli, "memory", ...argumentsList, "--cwd", directory], { encoding: "utf8", windowsHide: true });
  const added = run("add", "--kind", "learning", "--statement", "Memory citations are controller validated.", "--tags", "memory,controller", "--source", "docs/architecture.md:2-3");
  assert.equal(added.status, 0, added.stderr || added.stdout);
  const id = /Project memory (memory-[a-f0-9]+) is active/.exec(added.stdout)[1];
  const listed = run("list");
  assert.equal(listed.status, 0, listed.stderr || listed.stdout);
  assert.match(listed.stdout, new RegExp(id));
  const validated = run("validate");
  assert.equal(validated.status, 0, validated.stderr || validated.stdout);
  const archived = run("archive", "--id", id, "--reason", "No longer current");
  assert.equal(archived.status, 0, archived.stderr || archived.stdout);
  assert.equal(readProjectMemory(paths).entries[0].status, "archived");
});

test("workflow injects validated relevant memory and promotes only reviewer-approved candidates", async () => {
  const { directory, paths } = fixture("night-project-memory-workflow-");
  addProjectMemory(paths, candidate());
  const taskFile = path.join(directory, "workflow.tasks.json");
  fs.writeFileSync(taskFile, JSON.stringify({
    schemaVersion: 2,
    tasks: [{ id: "one", title: "Project memory", objective: "Improve controller memory", acceptanceCriteria: ["Memory facts have citations"], verification: [`"${process.execPath}" -e "process.exit(0)"`], dependsOn: [] }]
  }));
  const proposal = { outcomeSummary: "Memory task is ready.", importantDecisions: [], knownProblems: [], verificationEvidence: ["Verification passed."], nextActions: ["Await acceptance."], humanAcceptanceActions: ["Inspect and accept."], memoryCandidates: [] };
  const reviewerProposal = {
    ...proposal,
    memoryCandidates: [{ kind: "decision", statement: "Project memory is grounded in repository citations.", tags: ["memory", "citations"], citations: [{ path: "docs/architecture.md", startLine: 2, endLine: 3 }] }]
  };
  const fakeCodex = path.join(directory, "fake-codex.js");
  fs.writeFileSync(fakeCodex, `
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const output = args[args.indexOf("--output-last-message") + 1];
const work = args[args.indexOf("--sandbox") + 1] === "workspace-write";
if (work) fs.writeFileSync(path.join(process.cwd(), "worker-prompt.txt"), args.at(-1));
const payload = work
  ? ${JSON.stringify({ status: "COMPLETE", assessment: "Implemented.", evidence: ["Evidence."], nextStep: "Review.", blockerReason: "", projectStateProposal: proposal })}
  : ${JSON.stringify({ decision: "SHIP", assessment: "Ready.", feedback: "Ready.", evidence: ["Inspected."], projectStateReview: { decision: "APPROVE", proposal: reviewerProposal, feedback: "Approved." } })};
fs.writeFileSync(output, JSON.stringify(payload));
`);
  const state = await runWorkflow({
    cwd: directory,
    taskFile,
    mode: "interactive",
    taskId: "one",
    resume: false,
    maxAttempts: 1,
    maxTasks: 0,
    maxStagnantAttempts: 2,
    idleTimeoutSeconds: 2,
    hardTimeoutSeconds: 5,
    checkpoint: false,
    allowDirty: false,
    reclaimStaleLock: false,
    codexBin: fakeCodex,
    totalRuntimeSeconds: 60,
    minReadinessLevel: 0
  });
  assert.equal(state.tasks.one.automationStatus, "provisionally_complete");
  const prompt = fs.readFileSync(path.join(directory, "worker-prompt.txt"), "utf8");
  assert.match(prompt, /The controller uses evidence-backed project memory/);
  assert.match(prompt, /docs\/architecture\.md:2-3#sha256=/);
  const store = readProjectMemory(paths);
  assert.equal(store.entries.length, 2);
  assert.equal(store.entries.some((entry) => entry.source === "reviewer" && entry.statement === "Project memory is grounded in repository citations."), true);
  assert.match(fs.readFileSync(paths.handoffFile, "utf8"), /## Project memory[\s\S]*Active: 2/);
});

test("corrupted project-memory state is a global blocker with a readable handoff", async () => {
  const { directory, paths } = fixture("night-project-memory-corrupt-");
  fs.mkdirSync(paths.stateDir, { recursive: true });
  fs.writeFileSync(paths.projectMemoryFile, "{not-json");
  const taskFile = path.join(directory, "workflow.tasks.json");
  fs.writeFileSync(taskFile, JSON.stringify({
    schemaVersion: 2,
    tasks: [{ id: "one", title: "One", objective: "Do one thing", acceptanceCriteria: ["It works"], verification: [`"${process.execPath}" -e "process.exit(0)"`], dependsOn: [] }]
  }));
  const state = await runWorkflow({
    cwd: directory,
    taskFile,
    mode: "interactive",
    taskId: "one",
    resume: false,
    maxAttempts: 1,
    maxTasks: 0,
    maxStagnantAttempts: 2,
    idleTimeoutSeconds: 1,
    hardTimeoutSeconds: 1,
    checkpoint: false,
    allowDirty: false,
    reclaimStaleLock: false,
    codexBin: "must-not-run",
    totalRuntimeSeconds: 60,
    minReadinessLevel: 0
  });
  assert.equal(state.status, "blocked");
  assert.equal(state.stopReason, "invalid_project_memory");
  assert.equal(state.tasks.one.lastFailure.classification, "invalid_project_memory");
  const handoff = fs.readFileSync(paths.handoffFile, "utf8");
  assert.match(handoff, /Project-memory state is invalid/);
  assert.match(handoff, /## Project memory[\s\S]*Unreadable:/);
});
