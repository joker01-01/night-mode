import { TaskDocument, WorkflowPaths, WorkflowState } from "./types";
import { writeText } from "./storage";
import { gitSnapshot } from "./git";
import { projectMemoryCounts } from "./project-memory";

const path = require("node:path");

function bulletList(values: string[] | undefined): string[] {
  return values?.length ? values.map((value) => `- ${value}`) : ["- None."];
}

function commandArgument(value: string): string {
  return /^[A-Za-z0-9_./:\\-]+$/.test(value) ? value : `"${value.replaceAll('"', '\\"')}"`;
}

function workflowCommand(): string {
  const configured = process.env.CODEX_WORKFLOW_COMMAND?.trim();
  if (configured) return configured;
  return `${commandArgument(process.execPath)} ${commandArgument(path.join(__dirname, "index.js"))}`;
}

function changedPaths(paths: WorkflowPaths, state: WorkflowState): { preExisting: string[]; workflow: string[] } {
  const baseline = new Set(state.gitBaseline.initialChangedPaths);
  const current = gitSnapshot(paths.cwd, paths.stateDir);
  const recorded = Object.values(state.tasks).flatMap((task) => task.changedPaths ?? []);
  const workflow = [...new Set([...recorded, ...current.changedPaths])]
    .filter((item) => !baseline.has(item))
    .filter((item) => !["PROJECT_STATE.md", "MORNING_REPORT.md"].includes(item));
  return { preExisting: [...new Set(state.gitBaseline.initialChangedPaths)], workflow };
}

export function writeHandoff(paths: WorkflowPaths, state: WorkflowState, document: TaskDocument): void {
  const provisionallyComplete = Object.entries(state.tasks).filter(([, task]) => task.automationStatus === "provisionally_complete");
  const accepted = provisionallyComplete.filter(([, task]) => task.humanAcceptanceStatus === "accepted");
  const awaitingAcceptance = provisionallyComplete.filter(([, task]) => task.humanAcceptanceStatus === "awaiting_human_acceptance");
  const rejected = Object.entries(state.tasks).filter(([, task]) => task.humanAcceptanceStatus === "rejected");
  const blocked = Object.entries(state.tasks).filter(([, task]) => ["blocked", "dependency_blocked"].includes(task.automationStatus));
  const limited = Object.entries(state.tasks).filter(([, task]) => task.automationStatus === "limit_reached");
  const open = Object.entries(state.tasks).filter(([, task]) => ["pending", "needs_review", "running"].includes(task.automationStatus));
  const changes = changedPaths(paths, state);
  const proposal = state.approvedProjectState;
  const command = workflowCommand();
  const targetOptions = `--cwd ${commandArgument(paths.cwd)} --state-dir ${commandArgument(paths.stateDir)}`;
  const lines = [
    "# Codex Workflow Handoff",
    "",
    `- Run: \`${state.runId}\``,
    `- Mode: \`${state.mode}\``,
    `- Outcome: \`${state.status}\`${state.stopReason ? ` (${state.stopReason})` : ""}`,
    `- Updated: ${state.updatedAt}`,
    "",
    "## Provisionally complete"
  ];
  lines.push(...(provisionallyComplete.length ? provisionallyComplete.map(([id, task]) => `- \`${id}\` (human: ${task.humanAcceptanceStatus}): ${task.lastAssessment ?? "accepted by reviewer"}${task.checkpoint ? `; checkpoint \`${task.checkpoint}\`` : ""}${task.checkpointError ? `; checkpoint error: ${task.checkpointError}` : ""}`) : ["- None."]));
  lines.push("", "## Human accepted");
  lines.push(...(accepted.length ? accepted.map(([id, task]) => `- \`${id}\`${task.humanAcceptanceAt ? ` at ${task.humanAcceptanceAt}` : ""}${task.checkpoint ? `; checkpoint \`${task.checkpoint}\`` : ""}`) : ["- None."]));
  lines.push("", "## Awaiting human acceptance");
  lines.push(...(awaitingAcceptance.length ? awaitingAcceptance.map(([id]) => `- \`${id}\`: run \`${command} accept ${targetOptions} --task ${commandArgument(id)}\` or \`${command} reject ${targetOptions} --task ${commandArgument(id)} --reason \"<reason>\"\`.`) : ["- None."]));
  lines.push("", "## Rejected");
  lines.push(...(rejected.length ? rejected.map(([id, task]) => `- \`${id}\`: ${task.lastFeedback ?? task.lastAssessment ?? "No rejection reason recorded."}; rework with \`${command} resume ${targetOptions} --tasks ${commandArgument(state.taskSourceFile)} --mode ${state.mode}\`${task.checkpoint ? `; preserved checkpoint \`${task.checkpoint}\`` : ""}.`) : ["- None."]));
  lines.push("", "## Blocked or dependency-blocked");
  lines.push(...(blocked.length ? blocked.map(([id, task]) => `- \`${id}\`: ${task.blockerReason ?? task.lastAssessment ?? "No reason recorded."}`) : ["- None."]));
  lines.push("", "## Limit reached");
  lines.push(...(limited.length ? limited.map(([id, task]) => `- \`${id}\`: ${task.lastAssessment ?? "Resource limit reached."}`) : ["- None."]));
  lines.push("", "## Needs attention");
  lines.push(...(open.length ? open.map(([id, task]) => `- \`${id}\`: ${task.lastFeedback ?? task.lastAssessment ?? "Pending."}`) : ["- None."]));
  lines.push("", "## Decisions and reviewer evidence");
  lines.push(`- Project-state review: \`${state.projectStateReviewDecision ?? "not available"}\``);
  for (const [id, task] of Object.entries(state.tasks)) {
    if (task.lastDecision || task.lastAssessment || task.lastFeedback) {
      lines.push(`- \`${id}\`: decision=${task.lastDecision ?? "not recorded"}; assessment=${task.lastAssessment ?? "not recorded"}; feedback=${task.lastFeedback ?? "not recorded"}`);
    }
  }
  lines.push("", "## Important decisions");
  lines.push(...bulletList(proposal?.importantDecisions));
  lines.push("", "## Known problems and risks");
  lines.push(...bulletList(proposal?.knownProblems));
  lines.push("", "## Next actions");
  lines.push(...bulletList(proposal?.nextActions));
  lines.push("", "## Human acceptance actions");
  lines.push(...bulletList(proposal?.humanAcceptanceActions));
  lines.push("", "## Checkpoints");
  const checkpointTasks = Object.entries(state.tasks).filter(([, task]) => task.checkpoint || task.checkpointError);
  lines.push(...(checkpointTasks.length
    ? checkpointTasks.map(([id, task]) => `- \`${id}\`: ${task.checkpoint ? `created \`${task.checkpoint}\`` : "not created"}${task.checkpointError ? `; error: ${task.checkpointError}` : ""}`)
    : ["- None."]));
  lines.push("", "## Dependencies and downstream impact");
  for (const task of document.tasks) {
    const execution = state.tasks[task.id];
    lines.push(`- \`${task.id}\`: depends on ${task.dependsOn.length ? task.dependsOn.map((dependency) => `\`${dependency}\``).join(", ") : "none"}; current status=${execution?.automationStatus ?? "missing"}.`);
  }
  lines.push("", "## Verification evidence");
  for (const [id, task] of Object.entries(state.tasks)) {
    const validation = task.validation;
    if (!validation) continue;
    lines.push(`- \`${id}\`: \`${validation.status}\`${validation.commands.length ? `; logs: ${validation.commands.map((command) => command.outputFile).join(", ")}` : ""}`);
    for (const gate of validation.qualityGates ?? []) {
      lines.push(`  - Quality gate \`${gate.id}\` [${gate.kind}]: \`${gate.status}\`; log \`${gate.command.outputFile}\``);
      for (const evidence of gate.evidence) {
        lines.push(`    - Evidence \`${evidence.path}\`: ${evidence.exists && evidence.regularFile && evidence.fresh && evidence.sha256 ? `fresh; ${evidence.bytes ?? 0} bytes; SHA-256 \`${evidence.sha256}\`` : evidence.failure ?? "missing, stale, or not a regular file"}`);
      }
    }
  }
  lines.push("", "## Readiness");
  if (state.readiness) {
    lines.push(`- Level: \`${state.readiness.level}/4\`; required: \`${state.readiness.minimumLevel}/4\`; gate: \`${state.readiness.ready ? "passed" : "failed"}\``);
    lines.push(`- Summary: ${state.readiness.summary}`);
    lines.push(`- Report: \`${paths.readinessReportFile}\``);
    for (const check of state.readiness.checks.filter((item) => item.status !== "pass")) lines.push(`- ${check.status}: \`${check.code}\` — ${check.detail}`);
  } else {
    lines.push("- No readiness assessment was recorded for this run.");
  }
  lines.push("", "## Project memory");
  try {
    const memory = projectMemoryCounts(paths);
    lines.push(`- Active: ${memory.active}; stale: ${memory.stale}; missing: ${memory.missing}; expired: ${memory.expired}; archived: ${memory.archived}; total retained: ${memory.total}.`);
  } catch (error) {
    lines.push(`- Unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  lines.push(`- Report: \`${paths.projectMemoryReportFile}\``);
  lines.push("- Only validated, task-relevant active entries are injected into worker context; inactive entries remain available for audit.");
  lines.push("", "## Changed paths");
  lines.push(`- Pre-existing at run start: ${changes.preExisting.length ? changes.preExisting.map((item) => `\`${item}\``).join(", ") : "none"}`);
  lines.push(`- Workflow-created or changed: ${changes.workflow.length ? changes.workflow.map((item) => `\`${item}\``).join(", ") : "none"}`);
  lines.push("- Machine-state artifacts are listed below and are excluded from checkpoints.");
  lines.push("", "## Failure evidence");
  for (const [id, task] of Object.entries(state.tasks)) {
    const failure = task.lastFailure;
    if (!failure) continue;
    lines.push(`- \`${id}\`: [${failure.phase}/${failure.classification}] ${failure.primaryCause}`);
    if (failure.exitCode !== undefined || failure.timedOut) lines.push(`  - Exit: ${failure.exitCode ?? "unknown"}${failure.timedOut ? `; timeout: ${failure.timedOut}` : ""}`);
    if (failure.logFile) lines.push(`  - Log: \`${failure.logFile}\``);
    lines.push(`  - Changed paths: ${failure.changedPaths.length ? failure.changedPaths.map((item) => `\`${item}\``).join(", ") : "none"}`);
    lines.push(`  - Next action: ${failure.nextAction}`);
  }
  lines.push("", "## Git preflight");
  lines.push(`- Initial commit: \`${state.gitBaseline.initialCommit ?? "none"}\``);
  lines.push(`- Initial worktree: \`${state.initialGitClean ? "clean" : "dirty"}\``);
  lines.push(`- Initial changed paths: ${state.gitBaseline.initialChangedPaths.length ? state.gitBaseline.initialChangedPaths.map((item) => `\`${item}\``).join(", ") : "none"}`);
  lines.push(`- Baseline representation: \`${state.gitBaseline.representationHash}\``);
  lines.push(`- Checkpoints allowed: \`${state.checkpointAllowed}\``);
  lines.push(...(state.preflightWarnings.length ? state.preflightWarnings.map((warning) => `- Warning: ${warning}`) : ["- No preflight warnings."]));
  lines.push("", "## Resource limits");
  lines.push(`- Budget started: ${state.budgetStartedAt ?? state.startedAt}`);
  lines.push(`- Tasks processed in this run segment: ${state.tasksProcessed ?? 0}`);
  lines.push(`- Total runtime limit: ${state.limits?.totalRuntimeSeconds ?? "not recorded"} seconds`);
  lines.push(`- Maximum tasks: ${state.limits?.maxTasks ?? "not recorded"}`);
  lines.push(`- Maximum attempts per task: ${state.limits?.maxAttempts ?? "not recorded"}`);
  lines.push("", "## Acceptance checklist");
  for (const task of document.tasks) {
    lines.push(`- \`${task.id}\` — ${task.title}`);
    lines.push(...(task.acceptanceCriteria.length ? task.acceptanceCriteria.map((criterion) => `  - [ ] ${criterion}`) : ["  - [ ] No explicit acceptance criteria were supplied."]));
  }
  lines.push("", "## Artifacts", `- State: \`${paths.stateFile}\``, `- Events: \`${paths.eventsFile}\``, `- Failure memory: \`${paths.failureFile}\``, `- Project memory JSON: \`${paths.projectMemoryFile}\``, `- Project memory report: \`${paths.projectMemoryReportFile}\``, `- Readiness JSON: \`${paths.readinessFile}\``, `- Readiness report: \`${paths.readinessReportFile}\``, `- Handoff: \`${paths.handoffFile}\``, `- Project state: \`${path.join(paths.cwd, "PROJECT_STATE.md")}\``);
  if (state.mode === "night") lines.push(`- Morning report: \`${path.join(paths.cwd, "MORNING_REPORT.md")}\``);
  const content = `${lines.join("\n")}\n`;
  writeText(paths.handoffFile, content);
  if (state.mode === "night") writeText(path.join(paths.cwd, "MORNING_REPORT.md"), content);
}
