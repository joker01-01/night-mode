# Night-Mode

[![License: MIT](https://img.shields.io/badge/License-MIT-800080?style=flat-square)](LICENSE)
![Platform: Windows | macOS | Linux](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-0078D4?style=flat-square)
![Runtime: Node.js 22+](https://img.shields.io/badge/Runtime-Node.js%2022%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Integration: Codex CLI](https://img.shields.io/badge/Integration-Codex%20CLI-111111?style=flat-square)
![Modes: Interactive | Night Shift](https://img.shields.io/badge/Modes-Interactive%20%7C%20Night%20Shift-D97706?style=flat-square)
![Acceptance: Human Required](https://img.shields.io/badge/Acceptance-Human%20Required-2EA44F?style=flat-square)

**English** | [简体中文](README.zh-CN.md) | [日本語](README.ja-JP.md)

A file-backed, cross-platform Codex workflow controller for supervised daytime development and bounded autonomous Night Shift execution.

`v0.1.0` · MIT · Node.js 22+ · Codex CLI · Windows / macOS / Linux

Night-Mode keeps approved requirements immutable, starts each worker and reviewer with fresh context, runs verification outside the agent, preserves durable project state, and leaves final acceptance to a human.

## Why Night-Mode

Long-running AI development usually fails in one of four places: context disappears between sessions, an agent declares success too early, unattended work drifts, or the human cannot quickly understand what changed. Night-Mode makes those boundaries explicit:

- **Project continuity:** repository-backed state, handoff reports, failure memory, and citation-backed project memory survive fresh Codex contexts.
- **Two supervision levels:** Interactive mode stops after one selected task; Night Shift continues only when explicitly enabled and within runtime, task, and attempt limits.
- **Evidence before completion:** the controller runs declared verification and artifact-backed quality gates, then a separate read-only reviewer decides `SHIP`, `REVISE`, or `BLOCKED`.
- **Human authority:** reviewer `SHIP` is provisional. Only `accept` creates final human completion; `reject` reopens work without destructive rollback.

## Choose a mode

| Mode | Use it when | Behavior |
| --- | --- | --- |
| Interactive | You want turn-by-turn control | Runs one explicit task, verifies, reviews, writes a handoff, then stops for human acceptance. |
| Night Shift | You explicitly want bounded unattended progress | Processes dependency-ready tasks until the queue finishes, a blocker appears, `STOP` is detected, or a resource limit is reached. |

Night Shift defaults to 8 hours, 10 processed tasks per run segment, and 3 attempts per task. It is never selected implicitly.

## Requirements

- Node.js 22 or newer.
- Git; every workflow target must be a Git working tree.
- Codex CLI installed, authenticated, and usable with the user's existing configuration.
- npm or pnpm for the installed Skill's first build. Night-Mode never runs the target project's advisory install command automatically.

## Install

Install the repository root as the `night-mode` Codex Skill:

```text
python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo joker01-01/night-mode --path . --name night-mode
```

Restart Codex after installation. The wrapper lives inside the installed Skill:

```text
# macOS / Linux
node ~/.codex/skills/night-mode/scripts/night-mode help

# PowerShell
node "$HOME\.codex\skills\night-mode\scripts\night-mode" help
```

The wrapper resolves its own installation directory, installs only its locked build dependency when missing, rebuilds stale TypeScript output, and keeps the target repository as the working directory.

## Quick start

### 1. Create the immutable task file

From the target Git repository, copy the example and replace its sample task with concrete requirements:

```text
# macOS / Linux
cp ~/.codex/skills/night-mode/workflow.tasks.example.json workflow.tasks.json

# PowerShell
Copy-Item "$HOME\.codex\skills\night-mode\workflow.tasks.example.json" ".\workflow.tasks.json"
```

Every schema-version-2 task needs a unique `id`, an objective, explicit acceptance criteria, at least one controller-run verification command, and a `dependsOn` array. Optional `qualityGates` can require fresh integration or user-path evidence.

### 2. Check readiness

```text
node ~/.codex/skills/night-mode/scripts/night-mode readiness \
  --cwd /path/to/project --tasks workflow.tasks.json
```

Inspect `READINESS.md`. Night Shift requires level 2 by default; select level 3 for artifact-backed integration coverage or level 4 for explicit bootstrap assumptions and user-path QA on every task.

### 3. Run one Interactive task

```text
node ~/.codex/skills/night-mode/scripts/night-mode run \
  --cwd /path/to/project --tasks workflow.tasks.json --task example-001
```

The controller starts a fresh `workspace-write` worker, runs the declared checks, starts a fresh `read-only` reviewer, and writes `.codex/workflow/HANDOFF.md`.

### 4. Accept or reject the provisional result

```text
node ~/.codex/skills/night-mode/scripts/night-mode accept \
  --cwd /path/to/project --task example-001

node ~/.codex/skills/night-mode/scripts/night-mode reject \
  --cwd /path/to/project --task example-001 --reason "Explain what must be corrected."
```

Use the exact command printed in `HANDOFF.md` when a custom state directory is configured.

## Use it directly as a Skill

You can ask Codex to operate the installed Skill instead of assembling CLI flags yourself:

```text
$night-mode
Run Interactive mode in /path/to/project using workflow.tasks.json.
Execute task example-001, then stop for my acceptance.
```

For autonomous work, make the mode and limits explicit:

```text
$night-mode
Run Night Shift in /path/to/project using workflow.tasks.json.
Require readiness level 3, stop after 2 hours or 5 tasks, and preserve a Morning Report.
```

## Night Shift, stop, and resume

```text
# Start bounded Night Shift.
node ~/.codex/skills/night-mode/scripts/night-mode run \
  --cwd /path/to/project --tasks workflow.tasks.json --mode night \
  --min-readiness 3 --total-runtime 7200 --max-tasks 5 --max-attempts 3

# Explicitly allow an already-dirty target; checkpoints are disabled.
node ~/.codex/skills/night-mode/scripts/night-mode run \
  --cwd /path/to/project --tasks workflow.tasks.json --mode night --allow-dirty

# Resume an interrupted or limit-reached run.
node ~/.codex/skills/night-mode/scripts/night-mode resume \
  --cwd /path/to/project --tasks workflow.tasks.json --mode night

# Inspect current state.
node ~/.codex/skills/night-mode/scripts/night-mode status --cwd /path/to/project
```

Create `.codex/workflow/PAUSE` to prevent a new phase from starting, or `.codex/workflow/STOP` to end at the nearest safe boundary. Night Shift always writes `MORNING_REPORT.md` before exit.

## Readiness and evidence

`readiness` writes `.codex/workflow/readiness.json` and `READINESS.md` without starting Codex. A declared bootstrap install command is advisory only; only a bounded health check may run, and readiness fails if that check changes the repository. Environment checks record variable names and presence, never values.

Each optional quality gate declares an `integration` or `user_path` command plus evidence paths. Exit code zero is insufficient: every artifact must be a fresh regular file produced or refreshed by the current command. The controller rejects stale, symlinked, escaping, controller-owned, or oversized evidence and records size plus SHA-256 for accepted artifacts.

## Project memory

Durable project memory is separate from retry-oriented failure memory. Reviewer-approved decisions, learnings, and constraints keep exact repository-relative line citations and content hashes. Before reuse, Night-Mode revalidates each citation, relocates uniquely moved text, and excludes changed, ambiguous, missing, expired, or archived entries without deleting their audit history.

```text
node ~/.codex/skills/night-mode/scripts/night-mode memory list --cwd /path/to/project
node ~/.codex/skills/night-mode/scripts/night-mode memory validate --cwd /path/to/project
node ~/.codex/skills/night-mode/scripts/night-mode memory add --cwd /path/to/project \
  --kind learning --statement "The API contract lives in src/contracts.ts." \
  --tags api,contracts --source src/contracts.ts:1-20
node ~/.codex/skills/night-mode/scripts/night-mode memory archive --cwd /path/to/project \
  --id memory-abc123 --reason "Superseded by the new contract."
```

## Artifacts

Night-Mode keeps execution metadata outside the immutable task document:

```text
.codex/workflow/
├── state.json                 # Run, task, dependency, and limit state
├── HANDOFF.md                 # Human review and exact next actions
├── readiness.json
├── READINESS.md
├── project-memory.json
├── PROJECT_MEMORY.md
├── failures.json              # Structured retry history
├── events.jsonl
├── phases/                    # Worker and reviewer JSONL output
└── validation/                # Verification and quality-gate evidence

PROJECT_STATE.md               # Reviewer-approved project continuity
MORNING_REPORT.md              # Night Shift summary
```

## Safety guarantees

- Interactive is the default; Night Shift requires explicit `--mode night`.
- Workers use `workspace-write`; reviewers use `read-only`.
- A worker cannot mark its own task complete. Verification, reviewer approval, an unchanged task hash, and human acceptance remain separate gates.
- Night Shift rejects dirty worktrees unless `--allow-dirty` is explicit; dirty runs cannot checkpoint.
- Git checkpoints are opt-in and occur only after accepted review and non-failing validation.
- The runner does not pass dangerous approval or sandbox-bypass flags and never uses reset, clean, rebase, fetch, force push, history rewriting, or unvalidated Git-lock deletion.
- Requirements remain human-owned. Execution state never mutates `workflow.tasks.json`.

## Develop and verify

```text
git clone https://github.com/joker01-01/night-mode.git
cd night-mode
npm ci
npm run typecheck
npm run build
npm test
node scripts/night-mode help
```

The automated suite contains 70 tests. V1 also passed the controlled real-Codex acceptance matrix defined in [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md), including Interactive accept/reject, Night dependencies, timeouts, blockers, pause/stop/resume, task mutation, stale locks, resource limits, and dirty-worktree behavior.

## Documentation

- [V1 requirements](PRODUCT_REQUIREMENTS.md)
- [Roadmap](ROADMAP.md)
- [Research and comparison](RESEARCH.md)
- [Changelog](CHANGELOG.md)
- [Release checklist](RELEASE_CHECKLIST.md)

The repository root is the distributable end-user Skill. Repository maintenance instructions are intentionally separate in `.agents/skills/night-mode-maintainer/SKILL.md`.

## License

[MIT](LICENSE)
