# Codex Development Workflow — V1 Delivery Roadmap

Status: Milestones 0 through 10 and V1 functional acceptance are complete. MIT release commit `3ebca15` and annotated tag `v0.1.0` are published; post-release multilingual documentation is in progress without moving the release tag.

The phases are ordered. Each phase must be implemented, verified, reviewed, documented, and stopped for human inspection before the next independent phase begins.

## Milestone 0 — Establish the Live Baseline

Goal: finish the currently pending real Codex integration check before changing contracts.

Work:

- initialize the controlled smoke-test directory as a Git repository;
- run the existing Interactive smoke task with a fresh state directory;
- inspect worker result, validation output, reviewer result, events, state, and handoff;
- record any real Codex CLI compatibility failure precisely.

Exit gate:

- the current controller either completes the full worker/verification/reviewer path or has one evidence-backed blocker documented;
- no claim that the final V1 requirements are implemented.

## Milestone 1 — Finalize Contracts and State Schema

Goal: make the final requirements machine-representable.

Work:

- introduce task `schemaVersion: 2`;
- require acceptance criteria, verification, and explicit `dependsOn`;
- validate the dependency DAG;
- separate automation and human-acceptance state;
- add provisional, rejected, dependency-blocked, and limit-reached outcomes;
- define structured project-state proposals and reviewer approval;
- update examples and reject legacy schema with an actionable migration message.

Exit gate:

- schema and contract tests cover valid and invalid documents;
- state transitions are enumerated and impossible transitions are rejected;
- no runtime scheduling change is bundled into this phase.

## Milestone 2 — Repository Preflight and Baseline Isolation

Goal: make workspace assumptions explicit before an agent starts.

Work:

- require a Git working tree;
- capture starting commit, status, and dirty baseline;
- allow dirty Interactive runs with a warning;
- reject dirty Night runs by default;
- add explicit `--allow-dirty` behavior and disable checkpoints in that mode;
- improve phase-launch errors to include primary cause and log path.

Exit gate:

- tests cover non-Git, clean Git, dirty Interactive, dirty Night rejection, and dirty Night override;
- no destructive Git command exists in source or tests.

## Milestone 3 — Dependency-Aware Scheduler

Goal: ensure Night Shift only performs safe, ready work.

Work:

- compute dependency readiness deterministically;
- run ready tasks in document order;
- propagate `dependency_blocked` through descendants;
- continue independent tasks after a task blocker;
- distinguish task blockers from global blockers;
- explain unmet dependencies in Interactive Mode.

Exit gate:

- tests cover chains, diamonds, independent branches, blockers, invalid graphs, and deterministic order;
- no dependent task runs before its prerequisites are automation-complete.

## Milestone 4 — Strict Completion and Failure Evidence

Goal: make automatic completion objectively defensible.

Work:

- require every verification command to pass;
- preserve exact command and phase logs;
- enrich failure memory with phase, classification, exit, timeout, log, changed paths, feedback, and next action;
- require materially different retries after repeated outcomes;
- ensure worker `COMPLETE` alone never advances state.

Exit gate:

- tests cover worker false completion, missing verification, failed verification, reviewer revise, reviewer block, repeated outcomes, and malformed agent output;
- failure reports expose the primary cause without requiring manual log discovery.

Implementation status: Complete. The controller now requires a schema-valid worker `COMPLETE`, `SHIP`, and `validation.status === "passed"`; it persists structured failure evidence with phase, classification, exit/timeout, logs, changed paths relative to the run baseline, feedback, verification, and next action. M4 tests cover false completion, missing/failed verification, reviewer revise/block, repeated outcomes, and malformed output.

## Milestone 5 — Dual Human Acceptance

Goal: separate AI confidence from final human authority.

Work:

- produce `provisionally_complete` after the automation gate;
- add `accept` and `reject` commands;
- require a reason for rejection;
- reopen rejected tasks and invalidate descendants;
- preserve all changes, commits, and evidence;
- prevent run-level output from calling provisional work human-complete.

Exit gate:

- Interactive success stops awaiting human acceptance;
- accept finalizes the task;
- reject reopens it and invalidates descendants without rollback;
- repeated accept/reject commands are idempotent or fail clearly.

Implementation status: Complete. `accept --task <id>` finalizes a provisional task and is idempotent when repeated. `reject --task <id> --reason <text>` reopens the task, records the human reason, invalidates transitive dependants as `dependency_blocked`, preserves all artifacts, and is idempotent when repeated. Interactive runs remain `needs_review` until acceptance.

## Milestone 6 — Reviewer-Approved Project Continuity

Goal: make a new Codex context able to continue from repository files alone.

Work:

- extend worker and reviewer result contracts with structured project-state data;
- add the managed section protocol for `PROJECT_STATE.md`;
- atomically create or update only the managed section after `SHIP`;
- preserve all human-owned content outside the section;
- update continuity state after provisional completion, acceptance, rejection, blocker, stop, and limit events.

Exit gate:

- byte-preservation tests protect human-owned content;
- a fresh-context acceptance test can identify current work, decisions, evidence, risks, and next actions using repository files only.

Implementation status: Complete. Worker and reviewer contracts require structured project-state data; the controller stores the reviewer-approved proposal, atomically creates or replaces only the managed `PROJECT_STATE.md` section, preserves all bytes outside the markers, rejects malformed marker layouts, and synchronizes provisional completion, human decisions, blockers, stops, and run completion. M6 tests passed 40/40, including a repository-file-only continuity read and stop lifecycle evidence.

## Milestone 7 — Bounded Night Shift and Recovery

Goal: make unattended operation finite and resumable.

Work:

- add mandatory total runtime, maximum task, and attempt limits with safe defaults;
- produce `limit_reached` without misclassifying tasks;
- check total limits during pause and between every phase;
- harden stop, pause, lock, stale-lock recovery, and resume transitions;
- prevent completed phases from being silently repeated.

Exit gate:

- tests cover every limit, pause-to-stop, process interruption, stale lock, and resume boundary;
- every exit path writes inspectable state and handoff artifacts.

Implementation status: Complete. Night Shift now has safe defaults for total runtime, maximum tasks, and per-task attempts; it records `limit_reached` separately from blockers, checks runtime while paused and between phases, preserves resumable run state, records interruption-driven phase reruns, validates resume target and task hash, requires explicit stale-lock reclamation, and writes handoff artifacts for limit and stop exits. M7 tests passed 45/45.

## Milestone 8 — Checkpoints and Human Handoff

Goal: make autonomous output recoverable and understandable.

Work:

- create optional local checkpoints only after provisional completion and only from a clean baseline;
- keep rejected provisional checkpoints without automatic rollback;
- separate pre-existing and workflow changes in reports;
- expand `HANDOFF.md` and `MORNING_REPORT.md` with decisions, evidence, risks, dependencies, limits, and exact human actions;
- ensure dirty override runs never checkpoint.

Exit gate:

- report fixtures cover success, revise, block, reject, dependency block, limit, stop, and dirty scenarios;
- checkpoint tests prove that no unrelated or machine-state files are committed.

## Milestone 9 — End-to-End Acceptance Matrix

Goal: prove the product with real Codex execution, not mocks alone.

Work:

- run the complete Interactive lifecycle including human accept and reject;
- run a bounded Night dependency graph with independent branches;
- exercise validation failure, reviewer revise, confirmed blocker, phase timeout, task mutation, pause, stop, resume, and limits;
- verify Windows BOM and global npm launcher behavior;
- run POSIX checks in an available compatible environment;
- inspect every produced state and handoff artifact.

Exit gate:

- every criterion in `PRODUCT_REQUIREMENTS.md` section 17 has recorded evidence;
- unresolved platform checks are labeled not verified rather than inferred.

## Milestone 10 — Documentation and V1 Release Candidate

Status: MIT release committed, tagged, and published on 2026-08-30.

Goal: make V1 installable, operable, and reviewable by someone without this conversation.

Work:

- update README installation, task schema, commands, safety model, status semantics, and recovery procedures;
- document the acceptance and rejection workflow;
- document Git and dirty-worktree requirements;
- reconcile `AGENTS.md`, `PROJECT_STATE.md`, examples, and CLI help;
- perform final typecheck, build, automated tests, source review, and live smoke acceptance.

Exit gate:

- a new operator can install, configure, run, stop, resume, inspect, accept, and reject using repository documentation alone;
- V1 functional acceptance evidence is complete and reviewed;
- release commit and annotated `v0.1.0` tag are published at the same verified commit; post-release documentation must use a new commit and must not move the tag.

## Deferred Beyond V1

- isolated-worktree parallel workers and integration review;
- providers other than Codex CLI;
- automatic task decomposition or PRD generation;
- service lifecycle orchestration;
- dashboard, terminal UI, notifications, and remote control;
- automatic cost accounting or billing controls;
- destructive or automatic rollback.
