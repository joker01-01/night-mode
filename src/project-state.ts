import { ProjectStateProposal, WorkflowState } from "./types";
import { fileExists, writeTextAtomic } from "./storage";

const fs = require("node:fs");

export const MANAGED_START = "<!-- codex-workflow:managed:start -->";
export const MANAGED_END = "<!-- codex-workflow:managed:end -->";

function bullets(values: string[]): string[] {
  return values.length ? values.map((value) => `- ${value}`) : ["- None."];
}

function currentTaskLines(state: WorkflowState): string[] {
  return Object.entries(state.tasks).map(([id, task]) => {
    const details = [
      `automation=${task.automationStatus}`,
      `human=${task.humanAcceptanceStatus}`,
      task.blockerReason ? `blocker=${task.blockerReason}` : undefined,
      task.humanAcceptanceReason ? `human reason=${task.humanAcceptanceReason}` : undefined
    ].filter(Boolean).join("; ");
    return `- \`${id}\`: ${details}`;
  });
}

function derivedNextActions(state: WorkflowState): string[] {
  const actions: string[] = [];
  for (const [id, task] of Object.entries(state.tasks)) {
    if (task.humanAcceptanceStatus === "awaiting_human_acceptance") actions.push(`Human must accept or reject \`${id}\`.`);
    if (task.humanAcceptanceStatus === "rejected") actions.push(`Resume \`${id}\` after reviewing the human rejection reason.`);
    if (task.automationStatus === "dependency_blocked") actions.push(`Resolve the rejected or blocked prerequisite before resuming \`${id}\`.`);
    if (task.automationStatus === "blocked") actions.push(`Inspect the blocker evidence for \`${id}\` before retrying.`);
  }
  return actions;
}

export function renderManagedProjectState(state: WorkflowState, proposal?: ProjectStateProposal): string {
  const approved = proposal ?? state.approvedProjectState;
  const nextActions = [...(approved?.nextActions ?? []), ...derivedNextActions(state)];
  const humanActions = [...(approved?.humanAcceptanceActions ?? []), ...derivedNextActions(state).filter((action) => action.startsWith("Human must"))];
  const lines = [
    MANAGED_START,
    "## Codex Workflow Managed State",
    `- Run: \`${state.runId}\``,
    `- Mode: \`${state.mode}\``,
    `- Workflow status: \`${state.status}\`${state.stopReason ? ` (${state.stopReason})` : ""}`,
    `- Updated: ${state.updatedAt}`,
    `- Budget: ${state.tasksProcessed ?? 0} task(s); ${state.limits?.totalRuntimeSeconds ?? "unknown"} second(s) total runtime; max tasks ${state.limits?.maxTasks ?? "unknown"}; max attempts/task ${state.limits?.maxAttempts ?? "unknown"}`,
    `- Reviewer project-state decision: \`${state.projectStateReviewDecision ?? "controller-summary"}\``,
    "",
    "### Current task state",
    ...currentTaskLines(state),
    "",
    "### Outcome summary",
    approved?.outcomeSummary ?? `No reviewer-approved proposal is available. Current workflow status is ${state.status}.`,
    "",
    "### Important decisions",
    ...bullets(approved?.importantDecisions ?? []),
    "",
    "### Known problems and risks",
    ...bullets(approved?.knownProblems ?? []),
    "",
    "### Verification evidence",
    ...bullets(approved?.verificationEvidence ?? []),
    "",
    "### Next actions",
    ...bullets(nextActions),
    "",
    "### Human acceptance actions",
    ...bullets(humanActions),
    MANAGED_END
  ];
  return lines.join("\n");
}

export function updateManagedProjectState(file: string, state: WorkflowState, proposal?: ProjectStateProposal): void {
  const existing = fileExists(file) ? fs.readFileSync(file, "utf8") : "";
  const start = existing.indexOf(MANAGED_START);
  const end = existing.indexOf(MANAGED_END);
  const secondStart = start < 0 ? -1 : existing.indexOf(MANAGED_START, start + MANAGED_START.length);
  const secondEnd = end < 0 ? -1 : existing.indexOf(MANAGED_END, end + MANAGED_END.length);
  if ((start < 0) !== (end < 0) || (start >= 0 && end < start) || secondStart >= 0 || secondEnd >= 0) {
    throw new Error(`Invalid managed PROJECT_STATE.md markers in ${file}.`);
  }

  const managed = renderManagedProjectState(state, proposal);
  let content: string;
  if (start < 0) {
    const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
    content = `${existing}${separator}${managed}\n`;
  } else {
    content = `${existing.slice(0, start)}${managed}${existing.slice(end + MANAGED_END.length)}`;
  }
  writeTextAtomic(file, content);
}
