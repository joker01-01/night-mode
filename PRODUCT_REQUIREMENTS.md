# Codex Development Workflow — V1 Final Requirements

Status: Finalized for implementation; delivery remains milestone-gated.

Date: 2026-08-21

Evidence base: `RESEARCH.md`, the current V1 source, controlled Windows acceptance attempts, and the completed Grill Me decisions.

## 1. Product Goal

Build a repository-local workflow controller for Codex that supports:

1. Durable project continuity across Codex contexts.
2. Human-in-the-loop Interactive development.
3. Explicitly enabled, bounded Night Shift execution.
4. Evidence-based worker/reviewer completion gates.
5. A clear human handoff and explicit final acceptance.

The product is not a general multi-agent platform and does not reimplement Codex itself.

## 2. Product Boundary

V1 is a dependency-light Node.js/TypeScript CLI that orchestrates fresh Codex CLI processes against one Git working tree.

V1 does not include:

- parallel workers;
- non-Codex providers;
- automatic task decomposition or PRD generation;
- production deployment or service orchestration;
- a web dashboard, terminal UI, or notifications;
- automatic rollback, destructive Git recovery, force push, or history rewriting.

## 3. Sources of Truth

The following sources have separate responsibilities:

- `workflow.tasks.json`: immutable human-authored requirements and dependency graph.
- `.codex/workflow/`: machine-owned execution state, phase output, validation evidence, failure memory, locks, and reports.
- `PROJECT_STATE.md`: durable, human-readable project continuity, updated only from reviewer-approved structured state.
- `AGENTS.md`: durable project rules; the workflow must not rewrite it automatically.

Execution metadata must never be written into the immutable task requirements.

## 4. Task Document

The final task schema is `schemaVersion: 2`.

Every task must contain:

- unique non-empty `id`;
- non-empty `title`;
- concrete `objective`;
- at least one non-empty `acceptanceCriteria` item;
- at least one non-empty controller-run `verification` command;
- an explicit `dependsOn: string[]`, which may be empty.

Before any agent runs, the controller must reject:

- duplicate IDs;
- unknown dependencies;
- self-dependencies;
- dependency cycles;
- empty acceptance criteria;
- missing or empty verification commands;
- unsupported schema versions.

The full task document is hashed. Any change during a run is a global hard blocker. A deliberate requirement change starts a new run; it is never silently merged into an existing run.

## 5. Dependency Semantics

The task queue is a directed acyclic graph.

- A task is runnable only when all dependencies are automation-complete.
- Scheduler order among ready tasks follows document order for deterministic execution.
- A genuinely blocked task makes its transitive dependants `dependency_blocked`.
- Independent ready tasks may continue during Night Shift.
- Interactive Mode runs only the user-selected task and must explain unmet dependencies instead of bypassing them.
- Rejecting a provisionally completed task reopens that task and invalidates its transitive dependants without deleting their artifacts.

## 6. Execution Modes

### Interactive Mode

Interactive is the default mode.

1. The user selects exactly one task.
2. The controller performs preflight checks.
3. A fresh worker runs with `workspace-write`.
4. The controller runs every declared verification command.
5. A fresh reviewer runs with `read-only`.
6. A passing task becomes provisionally complete and awaits human acceptance.
7. The controller updates state and handoff files, reports, and stops.

Interactive Mode never selects another product task automatically.

### Night Shift

Night Shift requires explicit `--mode night` and bounded resource limits.

1. Select the next dependency-ready task.
2. Run worker, verification, reviewer, and optional checkpoint.
3. Record provisional completion, failure, or blocker.
4. Continue independent ready tasks while limits permit.
5. Stop on queue exhaustion, global blocker, explicit stop, or resource limit.
6. Always write `MORNING_REPORT.md` before exit.

## 7. Completion Gate

Automation completion requires all of the following:

1. The worker returns a schema-valid `COMPLETE` result.
2. Every declared verification command exits successfully.
3. The independent reviewer returns a schema-valid `SHIP` decision.
4. The task document hash is unchanged.
5. The reviewer approves the structured project-state update.

Worker self-reporting alone never completes a task. Missing verification is a task-definition error, not a pass.

## 8. Dual-Layer Acceptance

Automation acceptance and human acceptance are distinct.

- After the completion gate passes, automation status becomes `provisionally_complete` and human status becomes `awaiting_human_acceptance`.
- Night Shift may treat `provisionally_complete` as dependency-ready so autonomous work can continue.
- `accept --task <id>` changes the final task state to `completed`.
- `reject --task <id> --reason <text>` reopens the task, records the reason, and invalidates transitive dependants.
- Rejection never resets, cleans, deletes, or silently rolls back work.
- A run cannot claim final human completion while tasks remain awaiting acceptance.

The state model must keep automation status and human status as separate fields rather than overloading one ambiguous status.

## 9. Project Continuity

The worker result must include a structured project-state proposal containing:

- current outcome summary;
- important decisions made;
- known problems and risks;
- verification evidence;
- next actions and human acceptance actions.

The reviewer must approve or correct that proposal. Only after `SHIP` may the controller atomically update `PROJECT_STATE.md`.

The controller owns only a marked managed section:

```text
<!-- codex-workflow:managed:start -->
...
<!-- codex-workflow:managed:end -->
```

Content outside that section is human-owned and must be preserved byte-for-byte. If the file is absent, the controller may create it with a managed section. Provisional, accepted, rejected, blocked, and limit-reached states must be represented honestly.

## 10. Failure and Retry Model

Every failed attempt must record:

- failure class;
- phase and exit code;
- timeout type when applicable;
- exact log path;
- worker assessment or attempted approach when available;
- reviewer feedback;
- verification result;
- changed paths relative to the run baseline;
- next required action.

Retries are bounded. Failure memory is read before every retry. Repeating the same classified outcome requires a materially different next attempt. Repeated outcomes beyond the configured threshold become `blocked`.

Task blockers and global blockers are distinct:

- A task blocker affects that task and its dependency descendants; independent Night tasks may continue.
- Authentication failure, missing Codex runtime, task-source mutation, invalid state, or unsafe repository preflight is a global blocker and stops the run.

## 11. Resource Limits

Night Shift must always be bounded by all three controls:

- total run duration, default 8 hours;
- maximum tasks processed, default 10;
- maximum attempts per task, default 3.

Idle and hard timeouts remain mandatory per Codex phase. Limits must also be checked while paused or between phases.

Reaching a resource cap produces `limit_reached`, preserves resumable state, and writes the morning report. It is not a task failure or blocker. Continuing requires an explicit `resume` command.

V1 does not depend on token or monetary-cost accounting.

## 12. Git and Workspace Safety

- Every target must be a Git working tree. V1 never passes `--skip-git-repo-check`.
- The controller captures the starting commit, status, and a baseline representation sufficient to distinguish pre-existing changes from workflow changes.
- Interactive Mode may run on a dirty worktree after an explicit warning and baseline capture.
- Night Shift refuses a dirty worktree by default.
- `--allow-dirty` is an explicit Night override; it requires baseline separation and disables checkpoints.
- Checkpoints are opt-in and local only.
- A checkpoint may be created only after automation completion, with a clean initial worktree, successful verification, and reviewer `SHIP`.
- A provisional checkpoint remains inspectable if a human later rejects the task; rejection creates corrective work rather than destructive rollback.
- The controller never runs reset, clean, force checkout, rebase, fetch, force push, history rewriting, or unvalidated Git-lock deletion.

## 13. Pause, Stop, Lock, and Resume

- One workflow lock is allowed per state directory.
- Lock metadata includes PID, start time, run ID, target, and command context.
- An active owner cannot be reclaimed.
- A dead or invalid lock may be reclaimed only through an explicit inspected action.
- `PAUSE` prevents starting new work while continuing to check stop and total-runtime limits.
- `STOP` ends at the nearest safe boundary and writes state and handoff artifacts.
- Resume requires the same target, task document path, and task hash.
- Resume never repeats a completed phase without recording why it was rerun.

## 14. CLI Surface

Required commands:

- `run`: start Interactive or explicit Night execution.
- `resume`: continue a stopped or limit-reached run.
- `status`: show run, task, dependency, validation, and human-acceptance state.
- `accept --task <id>`: record human acceptance.
- `reject --task <id> --reason <text>`: reopen a task and invalidate dependants.

Required Night controls include total runtime, maximum tasks, attempts, idle timeout, hard timeout, checkpoint opt-in, and dirty-worktree override.

Errors must identify the failing phase, primary cause, and artifact path. A generic `needs_review` message is insufficient for a phase-launch failure.

## 15. Artifacts and Human Handoff

Machine-owned state remains repository-local under the configured state directory and includes:

- atomic run state;
- task and dependency state;
- worker and reviewer structured results;
- phase JSONL logs;
- validation logs;
- failure memory;
- event history;
- lock metadata;
- baseline and changed-path evidence;
- `HANDOFF.md`.

Night Shift also writes `MORNING_REPORT.md` in the target root.

Handoff reports must show:

- provisional, human-accepted, rejected, blocked, dependency-blocked, and pending tasks separately;
- work completed and important decisions;
- pre-existing versus workflow-created changes;
- verification commands and real outcomes;
- reviewer decisions and feedback;
- checkpoints;
- failures, limits, and unresolved risks;
- exact human acceptance or rejection commands;
- downstream tasks affected by a rejection.

## 16. Codex and Platform Integration

- Support Windows and POSIX environments with Node.js 22 or newer.
- Use the user's existing Codex authentication and configuration; never copy credentials into workflow state or reports.
- Resolve the Windows global npm Codex launcher without relying on shell injection-prone command construction.
- Accept UTF-8 JSON with or without a BOM.
- Worker sandbox is `workspace-write`; reviewer sandbox is `read-only`.
- Never expose dangerous approval, hook-trust, or sandbox-bypass options through V1.

## 17. V1 Acceptance Criteria

V1 is complete only after all of the following pass:

1. Typecheck, build, and the full automated test suite.
2. A controlled real Interactive run in a temporary Git repository reaches provisional completion through worker, verification, and reviewer.
3. Human `accept` produces final completion; human `reject` reopens the task and invalidates dependants.
4. A controlled Night run executes multiple independent tasks, respects dependencies, and produces a truthful Morning Report.
5. Verification failure, reviewer `REVISE`, confirmed blocker, phase failure, timeout, task mutation, stale lock, pause, stop, resume, and resource limits are exercised.
6. Clean, dirty Interactive, rejected dirty Night, and explicit dirty Night behaviors are verified.
7. Windows BOM and Codex launcher behavior remain covered.
8. No acceptance scenario uses dangerous permissions or destructive Git recovery.

Passing unit tests without the controlled real Codex runs is not V1 acceptance.
