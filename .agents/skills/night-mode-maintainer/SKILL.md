---
name: night-mode-maintainer
description: Maintain or extend the Night-Mode TypeScript workflow runner in this repository. Use for source, tests, contracts, packaging, research, or release work here; do not use merely to run Night-Mode in another project.
---

# Night-Mode Maintainer

Read `AGENTS.md`, `TASK.md`, `PRODUCT_REQUIREMENTS.md`, `PROJECT_STATE.md`, `README.md`, and the relevant source and tests before changing the runner. Treat `TASK.md` and `PRODUCT_REQUIREMENTS.md` as requirements authority, preserve human-owned project-state text, and keep work limited to the current task.

## Non-negotiable contracts

- Interactive mode is the default; Night Shift is explicit and bounded.
- Task schema version 2 requires acceptance criteria, verification commands, and explicit dependencies.
- Never bypass dependencies, mutate task requirements, weaken verification, rewrite Git history, or add dangerous approval or sandbox-bypass flags.
- Worker `COMPLETE` plus reviewer `SHIP` remains provisional until declared verification passes, the task hash is unchanged, and a human accepts it.
- Preserve failure evidence, project continuity, handoff reports, locks, and resumable state on every exit path.
- Research competing implementations from real source and confirm licenses before adopting code.

## Change and verification discipline

Make the smallest recoverable change that satisfies the current task. Update project documentation when architecture, state, or next steps change. Run:

```text
npm run typecheck
npm run build
npm test
```

Inspect generated state and evidence before reporting success. Interactive work stops after the requested unit is implemented, verified, reviewed, and documented.
