import { QualityGateEvidence, QualityGateResult, TaskDefinition, ValidationResult, WorkflowPaths } from "./types";
import { appendEvent, ensureDir, sha256File } from "./storage";
import { spawnAndWatch } from "./process";

const fs = require("node:fs");
const path = require("node:path");

const MAX_EVIDENCE_BYTES = 100 * 1024 * 1024;

interface EvidenceSnapshot extends QualityGateEvidence {
  modifiedMs?: number;
}

function inspectEvidence(cwd: string, stateDir: string, evidencePath: string): EvidenceSnapshot {
  const absolute = path.resolve(cwd, evidencePath);
  const resolvedStateDir = path.resolve(stateDir);
  const relative = path.relative(cwd, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return { path: evidencePath, exists: false, regularFile: false, fresh: false, failure: "Evidence resolves outside the target repository." };
  }
  if (absolute === resolvedStateDir || absolute.startsWith(`${resolvedStateDir}${path.sep}`)) {
    return { path: evidencePath, exists: false, regularFile: false, fresh: false, failure: "Evidence targets the controller-owned state directory." };
  }
  if (!fs.existsSync(absolute)) return { path: evidencePath, exists: false, regularFile: false, fresh: false, failure: "Evidence file does not exist." };
  const realRoot = fs.realpathSync(cwd);
  const realEvidence = fs.realpathSync(absolute);
  const realRelative = path.relative(realRoot, realEvidence);
  if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    return { path: evidencePath, exists: true, regularFile: false, fresh: false, failure: "Evidence resolves outside the target repository through a symbolic-link parent." };
  }
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile()) return { path: evidencePath, exists: true, regularFile: false, fresh: false, failure: stat.isSymbolicLink() ? "Evidence must not be a symbolic link." : "Evidence is not a regular file." };
  if (stat.size > MAX_EVIDENCE_BYTES) return { path: evidencePath, exists: true, regularFile: true, fresh: false, bytes: stat.size, modifiedMs: stat.mtimeMs, failure: `Evidence exceeds the ${MAX_EVIDENCE_BYTES}-byte hashing limit.` };
  return { path: evidencePath, exists: true, regularFile: true, fresh: false, bytes: stat.size, sha256: sha256File(absolute), modifiedMs: stat.mtimeMs };
}

function finalizeEvidence(before: EvidenceSnapshot, after: EvidenceSnapshot): QualityGateEvidence {
  const fresh = after.exists
    && after.regularFile
    && after.sha256 !== undefined
    && (!before.exists || before.sha256 !== after.sha256 || (after.modifiedMs ?? 0) > (before.modifiedMs ?? 0));
  const failure = after.failure ?? (fresh ? undefined : "Evidence was not created or refreshed by this quality-gate command.");
  return { path: after.path, exists: after.exists, regularFile: after.regularFile, fresh, bytes: after.bytes, sha256: after.sha256, failure };
}

export async function runValidation(paths: WorkflowPaths, task: TaskDefinition, attempt: number, hardTimeoutSeconds: number): Promise<ValidationResult> {
  const commands = task.verification ?? [];
  if (commands.length === 0) return { status: "not_configured", commands: [] };
  const directory = path.join(paths.validationDir, task.id, `attempt-${attempt}`);
  ensureDir(directory);
  const results = [];
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    const outputFile = path.join(directory, `command-${index + 1}.log`);
    appendEvent(paths.eventsFile, "validation_started", { taskId: task.id, attempt, command });
    const result = await spawnAndWatch({ command, cwd: paths.cwd, outputFile, shell: true, idleTimeoutSeconds: 0, hardTimeoutSeconds });
    results.push(result);
    appendEvent(paths.eventsFile, "validation_finished", { taskId: task.id, attempt, command, exitCode: result.exitCode, timedOut: result.timedOut ?? null, outputFile });
  }

  const qualityGates: QualityGateResult[] = [];
  for (let index = 0; index < (task.qualityGates ?? []).length; index += 1) {
    const gate = task.qualityGates![index];
    const outputFile = path.join(directory, `quality-${index + 1}-${gate.id}.log`);
    const before = gate.evidencePaths.map((evidencePath) => inspectEvidence(paths.cwd, paths.stateDir, evidencePath));
    appendEvent(paths.eventsFile, "quality_gate_started", { taskId: task.id, attempt, gateId: gate.id, kind: gate.kind, command: gate.command });
    const command = await spawnAndWatch({ command: gate.command, cwd: paths.cwd, outputFile, shell: true, idleTimeoutSeconds: 0, hardTimeoutSeconds });
    const evidence = gate.evidencePaths.map((evidencePath, evidenceIndex) => finalizeEvidence(before[evidenceIndex], inspectEvidence(paths.cwd, paths.stateDir, evidencePath)));
    const invalid = evidence.filter((item) => !item.exists || !item.regularFile || !item.fresh || !item.sha256);
    const passed = command.exitCode === 0 && !command.timedOut && invalid.length === 0;
    const failure = passed
      ? undefined
      : command.exitCode !== 0 || command.timedOut
        ? `Quality gate command failed with ${command.timedOut ? `${command.timedOut} timeout` : `exit code ${command.exitCode}`}.`
        : `Quality gate did not produce fresh regular-file evidence: ${invalid.map((item) => `${item.path} (${item.failure ?? "invalid"})`).join(", ")}.`;
    qualityGates.push({ id: gate.id, kind: gate.kind, status: passed ? "passed" : "failed", command, evidence, failure });
    appendEvent(paths.eventsFile, "quality_gate_finished", {
      taskId: task.id,
      attempt,
      gateId: gate.id,
      kind: gate.kind,
      status: passed ? "passed" : "failed",
      outputFile,
      evidence: evidence.map((item) => ({ path: item.path, exists: item.exists, regularFile: item.regularFile, fresh: item.fresh, bytes: item.bytes ?? null, sha256: item.sha256 ?? null, failure: item.failure ?? null }))
    });
  }
  const passed = results.every((result) => result.exitCode === 0 && !result.timedOut)
    && qualityGates.every((gate) => gate.status === "passed");
  return { status: passed ? "passed" : "failed", commands: results, qualityGates };
}
