---
name: night-mode
description: Run, resume, inspect, accept, or reject a bounded Night-Mode Codex workflow in a Git repository. Use for operating the installed workflow runner; do not use for maintaining the Night-Mode source project itself.
---

# Night-Mode Runner

Operate the bundled workflow controller against a user-selected Git repository. Resolve `scripts/night-mode` relative to this `SKILL.md`; never assume the target repository contains the runner.

## Before running

- Read the target repository's `AGENTS.md` and the selected task document.
- Keep `workflow.tasks.json` human-authored and immutable during a run.
- Interactive mode is the default and requires one explicit task.
- Start Night Shift only after the user explicitly requests it. Keep total-runtime, task-count, and attempt limits enabled.
- Do not add dangerous approval, sandbox-bypass, Git-history rewrite, reset, clean, or force flags.

## Invoke the bundled runner

Use Node with the wrapper path inside this installed skill:

```text
node <skill-directory>/scripts/night-mode help
node <skill-directory>/scripts/night-mode readiness --cwd <target-repository> --tasks workflow.tasks.json
node <skill-directory>/scripts/night-mode run --cwd <target-repository> --tasks workflow.tasks.json --task <id>
node <skill-directory>/scripts/night-mode run --cwd <target-repository> --tasks workflow.tasks.json --mode night
node <skill-directory>/scripts/night-mode resume --cwd <target-repository> --tasks workflow.tasks.json --mode night
node <skill-directory>/scripts/night-mode status --cwd <target-repository>
node <skill-directory>/scripts/night-mode memory list --cwd <target-repository>
node <skill-directory>/scripts/night-mode memory validate --cwd <target-repository>
```

The wrapper locates its own installation, checks Node and build dependencies, installs missing development dependencies with the available lockfile-aware package manager, builds when needed, and then launches the runner.

Before Night Shift, inspect `READINESS.md`. The default Night gate requires level 2; use `--min-readiness 3` for artifact-backed integration coverage or `--min-readiness 4` for explicit bootstrap assumptions and user-path QA on every task. Never lower the requested level merely to start a run. Readiness health checks may inspect but must not mutate the target, and the runner never executes a declared install command automatically.

## Project memory

Workers receive only active memories that match the selected task. Each memory is backed by exact repository-relative line citations and a content hash; the controller revalidates citations before use, relocates uniquely moved text, and excludes stale, missing, expired, or archived entries without deleting their audit history.

Reviewer-approved completion may add durable decisions, learnings, or constraints. Inspect `.codex/workflow/PROJECT_MEMORY.md`; use `memory validate` after broad repository changes, `memory archive --id <id> --reason <text>` to retire an entry, and `memory add --kind <kind> --statement <text> --tags <csv> --source <path:start-end>` only for a human-confirmed repository fact. Never cite secrets, controller state, symlinks, or paths outside the target repository.

## Completion and human authority

A worker `COMPLETE`, passing declared verification and quality gates, and reviewer `SHIP` produce only `provisionally_complete`. Inspect `HANDOFF.md`, readiness, validation logs, fresh evidence hashes, reviewer evidence, changed paths, and any checkpoint before running the exact `accept` or `reject` command printed in the handoff.

Preserve failure evidence, `PROJECT_STATE.md`, resumable state, and Morning Reports. Report actual worker, verification, reviewer, and human-acceptance states separately.
