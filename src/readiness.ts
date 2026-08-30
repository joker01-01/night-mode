import { ReadinessAssessment, ReadinessCheck, ReadinessLevel, TaskDocument, WorkflowPaths } from "./types";
import { gitSnapshot } from "./git";
import { appendEvent, now, writeJsonAtomic, writeText } from "./storage";
import { spawnAndWatch } from "./process";

const childProcess = require("node:child_process");
const path = require("node:path");

function commandAvailable(command: string): boolean {
  const finder = process.platform === "win32" ? "where.exe" : "which";
  const result = childProcess.spawnSync(finder, [command], { cwd: process.cwd(), stdio: "ignore", windowsHide: true });
  return !result.error && result.status === 0;
}

function renderReadiness(assessment: ReadinessAssessment): string {
  const lines = [
    "# Night-Mode Readiness Report",
    "",
    `- Generated: ${assessment.generatedAt}`,
    `- Task source: \`${assessment.taskSourceFile}\``,
    `- Level: **${assessment.level} / 4**`,
    `- Required level: **${assessment.minimumLevel} / 4**`,
    `- Gate: **${assessment.ready ? "PASS" : "FAIL"}**`,
    `- Summary: ${assessment.summary}`,
    "",
    "## Checks"
  ];
  for (const check of assessment.checks) lines.push(`- **${check.status.toUpperCase()}** \`${check.code}\`: ${check.detail}`);
  if (assessment.bootstrapCheck) {
    lines.push("", "## Bootstrap check");
    lines.push(`- Command: \`${assessment.bootstrapCheck.command}\``);
    lines.push(`- Exit: ${assessment.bootstrapCheck.exitCode}${assessment.bootstrapCheck.timedOut ? `; timeout: ${assessment.bootstrapCheck.timedOut}` : ""}`);
    lines.push(`- Log: \`${assessment.bootstrapCheck.outputFile}\``);
  }
  lines.push("", "## Level model");
  lines.push("- Level 0: a declared prerequisite or repository check is blocked.");
  lines.push("- Level 2: valid Git repository and immutable tasks with controller-run verification.");
  lines.push("- Level 3: every task also declares an integration or user-path quality gate with artifact evidence.");
  lines.push("- Level 4: repository assumptions and bootstrap are explicit, and every task declares user-path QA evidence.");
  return `${lines.join("\n")}\n`;
}

export async function assessReadiness(
  paths: WorkflowPaths,
  document: TaskDocument,
  taskSourceFile: string,
  minimumLevel: ReadinessLevel,
  bootstrapTimeoutSeconds = 60
): Promise<ReadinessAssessment> {
  const checks: ReadinessCheck[] = [];
  const repository = gitSnapshot(paths.cwd, paths.stateDir);
  checks.push(repository.available
    ? { code: "git_repository", status: "pass", detail: `Git repository detected at ${paths.cwd}.` }
    : { code: "git_repository", status: "blocker", detail: repository.error ?? "The target is not a Git working tree." });
  checks.push({ code: "task_contract", status: "pass", detail: `${document.tasks.length} immutable task(s) have acceptance criteria, verification commands, and a valid dependency DAG.` });

  const requirements = document.readiness;
  let bootstrapCheck: ReadinessAssessment["bootstrapCheck"];
  if (!requirements) {
    checks.push({ code: "repository_assumptions", status: "warning", detail: "No readiness block declares required commands, environment names, network assumptions, or bootstrap health." });
  } else {
    checks.push({ code: "network_assumption", status: "pass", detail: `Network requirement is explicitly declared as ${requirements.network}; existing sandbox and approval rules remain unchanged.` });
    for (const command of requirements.requiredCommands) {
      checks.push(commandAvailable(command)
        ? { code: `command:${command}`, status: "pass", detail: `Required command ${command} is available on PATH.` }
        : { code: `command:${command}`, status: "blocker", detail: `Required command ${command} is not available on PATH.` });
    }
    for (const name of requirements.requiredEnvironment) {
      checks.push(typeof process.env[name] === "string" && process.env[name]!.length > 0
        ? { code: `environment:${name}`, status: "pass", detail: `Required environment variable ${name} is present; its value was not recorded.` }
        : { code: `environment:${name}`, status: "blocker", detail: `Required environment variable ${name} is missing or empty; no secret value was inspected or recorded.` });
    }
    if (requirements.bootstrap) {
      const beforeBootstrap = gitSnapshot(paths.cwd, paths.stateDir);
      const outputFile = path.join(paths.readinessDir, "bootstrap-check.log");
      bootstrapCheck = await spawnAndWatch({
        command: requirements.bootstrap.checkCommand,
        cwd: paths.cwd,
        outputFile,
        shell: true,
        idleTimeoutSeconds: 0,
        hardTimeoutSeconds: bootstrapTimeoutSeconds
      });
      const passed = bootstrapCheck.exitCode === 0 && !bootstrapCheck.timedOut;
      checks.push(passed
        ? { code: "bootstrap_health", status: "pass", detail: `Bootstrap health check passed. Install command is advisory and was not run automatically: ${requirements.bootstrap.installCommand}` }
        : { code: "bootstrap_health", status: "blocker", detail: `Bootstrap health check failed. Inspect ${outputFile}; run the declared install command manually if appropriate: ${requirements.bootstrap.installCommand}` });
      const afterBootstrap = gitSnapshot(paths.cwd, paths.stateDir);
      if (beforeBootstrap.representationHash !== afterBootstrap.representationHash) {
        checks.push({ code: "bootstrap_mutated_repository", status: "blocker", detail: "The bootstrap health check changed the target repository. Health checks must be non-mutating; inspect the Git diff and correct the declaration." });
      }
    } else {
      checks.push({ code: "bootstrap_health", status: "warning", detail: "No non-mutating bootstrap health check is declared; Night-Mode will never run an install command automatically." });
    }
  }

  const everyTaskHasQualityGate = document.tasks.every((task) => (task.qualityGates?.length ?? 0) > 0);
  const everyTaskHasUserPath = document.tasks.every((task) => task.qualityGates?.some((gate) => gate.kind === "user_path") === true);
  for (const task of document.tasks) {
    const gates = task.qualityGates ?? [];
    checks.push(gates.length
      ? { code: `quality_gates:${task.id}`, status: "pass", detail: `${gates.length} controller-run quality gate(s) declare artifact evidence.` }
      : { code: `quality_gates:${task.id}`, status: "warning", detail: "No integration or user-path quality gate is declared beyond ordinary verification." });
    if (!gates.some((gate) => gate.kind === "user_path")) {
      checks.push({ code: `user_path:${task.id}`, status: "warning", detail: "No user-path QA command with artifact evidence is declared." });
    }
  }

  const blocked = checks.some((check) => check.status === "blocker");
  let level: ReadinessLevel = blocked ? 0 : 2;
  if (!blocked && everyTaskHasQualityGate) level = 3;
  if (!blocked && requirements?.bootstrap && everyTaskHasUserPath) level = 4;
  const ready = !blocked && level >= minimumLevel;
  const summary = blocked
    ? "One or more declared prerequisites failed."
    : ready
      ? `Repository meets readiness level ${minimumLevel}.`
      : `Repository reached level ${level}, below the required level ${minimumLevel}.`;
  const assessment: ReadinessAssessment = {
    schemaVersion: 1,
    generatedAt: now(),
    taskSourceFile: path.resolve(taskSourceFile),
    level,
    minimumLevel,
    ready,
    summary,
    checks,
    bootstrapCheck
  };
  writeJsonAtomic(paths.readinessFile, assessment);
  writeText(paths.readinessReportFile, renderReadiness(assessment));
  if (path.resolve(paths.stateDir) !== path.resolve(paths.cwd)) {
    appendEvent(paths.eventsFile, "readiness_assessed", { level, minimumLevel, ready, report: paths.readinessReportFile });
  }
  return assessment;
}
