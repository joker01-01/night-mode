# Changelog

All notable changes to Night-Mode are documented here.

## [Unreleased]

### Documentation

- Added complete English, Simplified Chinese, and Japanese README variants with symmetric language navigation.
- Reworked the README around a value-first introduction, a four-step Quick Start, direct `$night-mode` examples, artifact visibility, and explicit safety boundaries informed by source-level comparison with related Skills.

## [0.1.0] - 2026-08-30

Initial V1 release.

### Workflow and safety

- Added explicit Interactive and bounded Night Shift execution over an immutable schema-version-2 task DAG.
- Added fresh `workspace-write` workers, independent `read-only` reviewers, controller-run verification, artifact-backed quality gates, and explicit human accept/reject.
- Added Git baseline separation, dirty-worktree policies, optional safe checkpoints, atomic workflow locks, pause/stop/resume, bounded retries, hard/idle timeouts, resource limits, and structured failure memory.
- Added task-source mutation detection and retained phase, validation, event, handoff, and Morning Report evidence without destructive Git recovery.

### Project continuity

- Added reviewer-approved managed project-state updates that preserve human-owned content.
- Added citation-backed project memory with bounded capture, SHA-256 evidence, revalidation, unique relocation, relevance filtering, expiration, archive, and audit retention.
- Added deterministic readiness levels and fresh artifact requirements for integration and user-path QA.

### Packaging and platform

- Added the distributable root `night-mode` Skill and a separate repository-maintainer Skill.
- Added the `scripts/night-mode` wrapper, which resolves its installed location, bootstraps locked build dependencies when absent, rebuilds stale TypeScript output, and emits executable handoff commands.
- Added Windows UTF-8 BOM handling and safe resolution of global npm Codex installations.

### Verification

- Typecheck and build pass.
- Automated suite passes 70/70 tests, including an isolated clean-install Skill smoke workflow.
- The controlled real-Codex M9 matrix passes all `PRODUCT_REQUIREMENTS.md` section 17 scenarios; detailed evidence remains under the ignored `.m9-acceptance/` directory.

### Distribution

- V1 is distributed as a GitHub-installed Codex Skill, not as an npm package. `package.json` remains private to prevent accidental npm publication.
- The project is MIT-licensed. Release commit `3ebca15` and annotated tag `v0.1.0` were published to `origin`.
