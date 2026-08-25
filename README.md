# Codex Development Workflow

A file-backed, cross-platform workflow runner for Codex. It keeps requirements in an immutable task document and execution artifacts in `.codex/workflow/`.

## Commands

```powershell
npm install
npm run build

# Interactive mode requires one explicit task.
node dist/index.js run --tasks workflow.tasks.json --task task-id

# Night Shift is explicit and processes the pending queue within caps.
node dist/index.js run --tasks workflow.tasks.json --mode night --max-attempts 3

# Override Night Shift's total runtime and task cap when needed.
node dist/index.js run --tasks workflow.tasks.json --mode night --total-runtime 3600 --max-tasks 5

# Explicitly permit a dirty Night Shift; this records a baseline and disables checkpoints.
node dist/index.js run --tasks workflow.tasks.json --mode night --allow-dirty

# Recover an interrupted run after reviewing its state.
node dist/index.js resume --tasks workflow.tasks.json --mode night
node dist/index.js status

# Human acceptance after an Interactive or Night run.
node dist/index.js accept --task task-id
node dist/index.js reject --task task-id --reason "Explain what must be corrected."
```

Night Shift defaults to an 8-hour total runtime, 10 tasks per run segment, and 3 attempts per task. Use `--total-runtime` (or `--max-runtime`) and `--max-tasks` to set explicit caps. Reaching a cap produces `limit_reached`, preserves state, and writes `MORNING_REPORT.md`; continue only with an explicit `resume` command.

`workflow.tasks.json` must use schema version 2 from `workflow.tasks.example.json`. Every task needs non-empty acceptance criteria, at least one verification command, and an explicit `dependsOn` array. Requirements are never mutated by the runner. Task automation status, human-acceptance status, attempts, validation results, phase outputs, failure memory and events are stored separately under `.codex/workflow/`.

Schema version 1 is rejected with a migration error. The dependency graph is validated before any Codex phase starts; unknown, self, duplicate, and cyclic dependencies are invalid.

Night Shift selects dependency-ready tasks in document order. A task blocker marks its transitive descendants `dependency_blocked` while independent tasks remain eligible. Interactive mode never bypasses dependencies; it records the unmet dependency statuses and stops before starting a worker.

Automation completion is represented separately from human acceptance: a reviewed task becomes `provisionally_complete` while awaiting human acceptance. `accept` changes its human status to `accepted`; `reject` reopens it as `pending`, records the reason, and marks transitive dependants `dependency_blocked` without deleting artifacts or rolling back Git changes.

Reviewer-approved project continuity is written to the managed section between `<!-- codex-workflow:managed:start -->` and `<!-- codex-workflow:managed:end -->` in `PROJECT_STATE.md`. The worker proposes the summary, decisions, risks, evidence, next actions, and human acceptance actions; the reviewer approves or corrects that proposal. Updates are atomic and preserve every byte outside the managed markers, so a fresh Codex context can continue from repository files without replacing human-owned notes.

## Safety model

- The worker uses Codex `workspace-write`; the reviewer always uses `read-only`.
- The runner never passes a dangerous approval or sandbox bypass flag.
- Verification commands are taken only from the declared task document and each command output is retained.
- Automatic completion requires worker `COMPLETE`, reviewer `SHIP`, every declared verification command to pass, and an unchanged task document; missing verification is never treated as a pass.
- Failed attempts retain structured phase/classification, exit or timeout, exact log, baseline-relative changed paths, feedback, verification, and next-action evidence. Repeated outcomes require a materially different retry approach.
- The task file hash is checked before and after each Codex phase. A mutation stops the run as blocked.
- Every target must be a Git working tree. The run state records the starting commit, status, changed paths, and baseline hash.
- Interactive mode warns and records the baseline on a dirty worktree. Night Shift rejects dirty worktrees unless `--allow-dirty` is explicit; dirty runs never create checkpoints.
- Phase-launch failures include the primary process error and the exact phase log path.
- Git checkpoints are off by default. If explicitly enabled, they require a clean initial worktree and only occur after review and validation acceptance.
- The runner never resets, cleans, rebases, fetches or deletes a Git lock.
- A run remains `needs_review` while work awaits human acceptance; only the explicit `accept` command finalizes the task.
- `PROJECT_STATE.md` records the latest reviewer-approved continuity proposal and honest controller lifecycle status for provisional completion, human decisions, blockers, stops, and run completion; malformed managed markers stop the update instead of risking human-owned content.
- `PAUSE` prevents new work while the controller continues checking `STOP` and the total-runtime cap. `STOP` exits at the nearest safe phase boundary.
- `resume` requires the same repository target, task document path, and task hash. It reopens resumable limit states and records an explicit reason when an interrupted phase must be rerun.
- A stale or invalid workflow lock is never reclaimed implicitly; inspect it first, then pass `--reclaim-stale-lock`. An active owner cannot be reclaimed.
