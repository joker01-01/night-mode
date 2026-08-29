---
name: night-mode
description: Operate and extend the repository-local Codex Development Workflow runner with safe Interactive and Night Shift execution, review gates, resumable state, and human acceptance.
---

# Night-Mode

Use this skill when working on this repository's Codex workflow runner or when a task needs its Interactive or Night Shift operating contract.

## Start with project state

Read `AGENTS.md`, `TASK.md`, `PROJECT_STATE.md`, `README.md`, and the relevant source and tests before changing code. Treat `TASK.md` and `PRODUCT_REQUIREMENTS.md` as the requirements authority. Keep each change limited to the current task and preserve human-owned project-state text.

## Operating contract

- Interactive mode is the default and requires one explicit task.
- Night Shift is opt-in with explicit `--mode night`, total-runtime, task-count, and per-task attempt limits.
- Task documents use schema version 2, with non-empty acceptance criteria, verification commands, and an explicit dependency list.
- Never bypass dependencies, mutate the task source, change Git history, or use dangerous approval or sandbox bypass flags.
- A worker `COMPLETE` and reviewer `SHIP` produce only provisional completion. Declared verification must pass, the task source hash must remain unchanged, and a human must explicitly accept the task before final completion.
- Preserve failure evidence, handoff reports, project-state continuity, and resumable state when a run stops or fails.

## Verification

After implementation, run the applicable typecheck, build, and test commands from the repository documentation. Do not claim completion from a worker result alone; inspect the generated state and evidence, and report the exact commands and outcomes.

Common commands:

```text
npm run typecheck
npm run build
npm test
```

For a human decision, use `accept --task <id>` or `reject --task <id> --reason "..."` only after reviewing the handoff and evidence.
