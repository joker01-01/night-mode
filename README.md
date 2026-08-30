# Codex Development Workflow

A file-backed, cross-platform workflow runner for Codex. It keeps requirements in an immutable task document and execution artifacts in `.codex/workflow/`.

## V1 status

Version `0.1.0` has completed the full automated suite and controlled real-Codex V1 acceptance matrix. The supported distribution path is installation from this GitHub repository as a Codex Skill; the Node package remains private to prevent accidental npm publication.

The project is licensed under MIT. The V1 release commit is tagged locally as `v0.1.0`; it has intentionally not been pushed, so the public GitHub repository remains at its previous state until the owner separately authorizes publication. See `CHANGELOG.md` and `RELEASE_CHECKLIST.md`.

## Prerequisites

- Node.js 22 or newer.
- Git, with every workflow target initialized as a Git working tree.
- Codex CLI installed, authenticated, and usable with the user's existing configuration.
- npm or pnpm available on the first launch when the installed Skill does not yet contain build dependencies; the wrapper installs only its own locked TypeScript build dependency and never runs the target repository's advisory install command.

## Install the user Skill

The repository root is the distributable `night-mode` user Skill. Install it with the Codex skill installer:

```text
python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo joker01-01/Night-Mode --path . --name night-mode
```

The installer places it at `~/.codex/skills/night-mode`. The bundled wrapper resolves that installation directory, installs missing build dependencies, builds the TypeScript runner when required, and launches it:

```text
# macOS / Linux
node ~/.codex/skills/night-mode/scripts/night-mode help

# PowerShell
node "$HOME\.codex\skills\night-mode\scripts\night-mode" help
```

This repository also contains a separate maintainer-only Skill at `.agents/skills/night-mode-maintainer/SKILL.md`. Codex discovers it while working in this checkout; it is not the end-user runner Skill.

## Develop from this checkout

```text
npm ci
node scripts/night-mode help
```

The same wrapper is used for every command below, so the commands printed into `HANDOFF.md` remain executable even when the runner is installed outside the target repository.

## Commands

```powershell
# Assess whether the repository is safe and testable enough for Night Shift.
node scripts/night-mode readiness --tasks workflow.tasks.json

# Interactive mode requires one explicit task.
node scripts/night-mode run --tasks workflow.tasks.json --task task-id

# Night Shift is explicit and processes the pending queue within caps.
node scripts/night-mode run --tasks workflow.tasks.json --mode night --max-attempts 3

# Require artifact-backed integration gates or full user-path readiness.
node scripts/night-mode run --tasks workflow.tasks.json --mode night --min-readiness 3
node scripts/night-mode run --tasks workflow.tasks.json --mode night --min-readiness 4

# Override Night Shift's total runtime and task cap when needed.
node scripts/night-mode run --tasks workflow.tasks.json --mode night --total-runtime 3600 --max-tasks 5

# Explicitly permit a dirty Night Shift; this records a baseline and disables checkpoints.
node scripts/night-mode run --tasks workflow.tasks.json --mode night --allow-dirty

# Recover an interrupted run after reviewing its state.
node scripts/night-mode resume --tasks workflow.tasks.json --mode night
node scripts/night-mode status

# Human acceptance after an Interactive or Night run.
node scripts/night-mode accept --task task-id
node scripts/night-mode reject --task task-id --reason "Explain what must be corrected."

# Inspect, revalidate, add, or retire evidence-backed project memory.
node scripts/night-mode memory list
node scripts/night-mode memory validate
node scripts/night-mode memory add --kind learning --statement "The API contract lives in src/contracts.ts." --tags api,contracts --source src/contracts.ts:1-20
node scripts/night-mode memory archive --id memory-abc123 --reason "Superseded by the new contract."
```

Night Shift defaults to an 8-hour total runtime, 10 tasks per run segment, and 3 attempts per task. Use `--total-runtime` (or `--max-runtime`) and `--max-tasks` to set explicit caps. Reaching a cap produces `limit_reached`, preserves state, and writes `MORNING_REPORT.md`; continue only with an explicit `resume` command.

## Readiness and user-path QA

`readiness` writes `.codex/workflow/readiness.json` and `READINESS.md`. Night Shift requires level 2 by default, and `--min-readiness` can raise the gate:

- Level 0: a declared prerequisite or repository check is blocked.
- Level 2: Git and immutable task contracts are valid, with controller-run verification.
- Level 3: every task adds an integration or user-path quality gate with artifact evidence.
- Level 4: repository assumptions and a non-mutating bootstrap health check are explicit, and every task has user-path QA.

The optional root `readiness` block declares command names, environment-variable names, network assumptions, and bootstrap health. Environment values are never copied into the report. `bootstrap.installCommand` is advisory and is never run automatically; only `bootstrap.checkCommand` runs, and readiness fails if that health check changes the repository.

Each optional task `qualityGates` entry has `id`, `kind` (`integration` or `user_path`), `command`, and `evidencePaths`. The controller runs the command, requires every evidence path to be a fresh regular file created or refreshed by that invocation, and records its byte size and SHA-256. Missing, stale, symbolic-link, out-of-repository, controller-owned, or oversized evidence fails validation even when the command exits zero. Browser traces, screenshots, JSON assertions, and CLI transcripts are suitable evidence; use the smallest artifact that lets a human inspect the user-visible result.

`workflow.tasks.json` must use schema version 2 from `workflow.tasks.example.json`. Every task needs non-empty acceptance criteria, at least one verification command, and an explicit `dependsOn` array. The backward-compatible `readiness` and `qualityGates` fields strengthen Night operation without changing existing task meaning. Requirements are never mutated by the runner. Task automation status, human-acceptance status, attempts, readiness, validation results, phase outputs, failure memory, project memory and events are stored separately under `.codex/workflow/`.

Schema version 1 is rejected with a migration error. The dependency graph is validated before any Codex phase starts; unknown, self, duplicate, and cyclic dependencies are invalid.

Night Shift selects dependency-ready tasks in document order. A task blocker marks its transitive descendants `dependency_blocked` while independent tasks remain eligible. Interactive mode never bypasses dependencies; it records the unmet dependency statuses and stops before starting a worker.

Automation completion is represented separately from human acceptance: a reviewed task becomes `provisionally_complete` while awaiting human acceptance. `accept` changes its human status to `accepted`; `reject` reopens it as `pending`, records the reason, and marks transitive dependants `dependency_blocked` without deleting artifacts or rolling back Git changes.

Reviewer-approved project continuity is written to the managed section between `<!-- codex-workflow:managed:start -->` and `<!-- codex-workflow:managed:end -->` in `PROJECT_STATE.md`. The worker proposes the summary, decisions, risks, evidence, next actions, and human acceptance actions; the reviewer approves or corrects that proposal. Updates are atomic and preserve every byte outside the managed markers, so a fresh Codex context can continue from repository files without replacing human-owned notes.

## Evidence-backed project memory

Project memory is separate from retry-oriented failure memory. A successful worker may propose durable `decision`, `learning`, or `constraint` entries, but only the independent reviewer's approved/corrected candidates reach `.codex/workflow/project-memory.json`. Every entry stores exact repository-relative line evidence, the cited text, its SHA-256, validation/use timestamps, origin, and retention status. Schema-valid candidates with unsafe or uncapturable evidence are recorded as rejected events and do not block otherwise valid task completion; structurally malformed reviewer output remains a contract failure.

Before every worker attempt, the controller revalidates all non-archived entries. An unchanged citation remains active; uniquely moved cited text receives updated line numbers; changed, ambiguous, missing, expired, or archived evidence is retained in the audit record but never injected. Selection is deterministic and task-relevant, with a maximum of eight entries; active constraints remain globally visible. Relevant use resets the default 28-day retention window. No record is auto-deleted.

`PROJECT_MEMORY.md` summarizes health and citations for human review. Manual add/validate/archive commands share the workflow lock with active runs. Candidate statements, tags, citation counts, source-file size, line count, and captured bytes are bounded. Citation capture accepts only non-empty text from regular non-symlink files inside the target repository and outside Git internals, controller state, and secret-like paths.

## Safety model

- The worker uses Codex `workspace-write`; the reviewer always uses `read-only`.
- The runner never passes a dangerous approval or sandbox bypass flag.
- Verification commands are taken only from the declared task document and each command output is retained.
- Readiness never auto-installs target dependencies. Declared bootstrap health checks are bounded and must leave the Git representation unchanged.
- Quality gates require fresh, repository-contained regular-file evidence and retain its size and SHA-256; an old artifact cannot satisfy a new run.
- Automatic completion requires worker `COMPLETE`, reviewer `SHIP`, every declared verification command to pass, and an unchanged task document; missing verification is never treated as a pass.
- Failed attempts retain structured phase/classification, exit or timeout, exact log, baseline-relative changed paths, feedback, verification, and next-action evidence. Repeated outcomes require a materially different retry approach.
- Project memory is reviewer-gated, citation-backed, revalidated before use, relevance-filtered, and audit-retained when invalidated or archived.
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
