# Reference Implementation Research

## Scope and Evidence

This research was completed before product implementation. The four required repositories were shallow-cloned into `research/references/` and inspected locally. Conclusions below are based on the implementation files named in each section, not on README claims.

| Repository | Local source snapshot | Commit inspected | Commit timestamp |
| --- | --- | --- | --- |
| MattMagg/ralph-wiggum-codex | `research/references/ralph-wiggum-codex/` | `1c6b68d8df95e351affd7bc361fda040c2c118b5` | 2026-03-06T00:13:51-05:00 |
| JH427/ralph-codex | `research/references/ralph-codex/` | `4609fac6a4f2c710159d5c59bb7526572035817e` | 2026-01-10T21:51:17-05:00 |
| Yeine/ralph | `research/references/yeine-ralph/` | `3660a9ac546d9410f7d0fa505ab5902864d58cc1` | 2026-02-06T07:29:12-05:00 |
| taberoajorge/ralph | `research/references/taberoajorge-ralph/` | `729f22b9fc89b5542d86df70bfe612eafcb70240` | 2026-04-08T11:37:58-06:00 |

`ralph-wiggum-codex` has a source-level smoke suite in `tests/smoke.sh`. Running it was not possible in this Windows environment because no `bash` executable is installed. No reference build or test result is claimed below; the statements are static source findings.

Legend: **Yes** means an implementation was located. **Partial** means the capability exists with a material limitation. **No** means no implementation was found in the inspected runtime sources. **UNVERIFIED** is reserved for claims that source did not establish.

## Comparison Matrix

| Capability | MattMagg | JH427 | Yeine | taberoajorge | Proposed V1 |
| --- | --- | --- | --- | --- | --- |
| Codex-native invocation | Yes | Yes | Yes, optional engine | Yes | Yes |
| Fresh context | Yes, new `codex exec` for work and review | Yes, new process per attempt | Yes, new engine invocation per iteration | Yes, new provider child per story iteration | Yes |
| Worker / reviewer split | Yes | No | No | No | Yes, reviewer read-only |
| Controller-run verification | Yes, configured commands | Yes, `verify.py` | No | Partial; prompt asks for tests, Rust test config is unused | Yes, declared commands only |
| Retry | Partial; timeout retry only | Yes, five story attempts | Yes, per-task attempts | Partial; rate-limit retry and provider-script retries differ | Bounded, classified retries |
| Timeout / process watchdog | Yes, idle and hard timeout | No | Yes, per iteration | Yes, no-output stall kill | Yes, idle and hard timeout |
| Stall detection | Yes, repeated outcome hash and idle timeout | No | Yes, non-productive/tool-call thresholds | Yes, no-output kill; repeated output only logs | Yes, process and outcome stall |
| Failure memory | Partial; iteration history and auto-feedback | Partial; append-only learnings | Yes, persistent attempt file | Yes, persistent diversity-aware JSON memory | Yes, structured per-task memory |
| Resume / recovery | Yes, state files and stale-lock recovery | Partial; re-run reads PRD/learnings only | Partial; attempts persist, run state does not | Partial; PRD/logs, pause and rate-wait state | Yes, durable run state plus lock |
| Git checkpoint | No; Git is a progress gate | Yes; commit after verification | No; status hash only | Partial; observes agent commits, no controller checkpoint | Optional, reviewed checkpoint only |
| PRD protection | No | Yes, field-level allowlist | No | Partial; backup/restore malformed JSON only | Yes, immutable-task validator |
| Completion detection | Worker `COMPLETE` + reviewer `SHIP` + validation | Exact `DONE` + tests + `passes` | Agent output markers | `prd.json` `passes` field | Independent reviewer and evidence gate |
| Rate-limit handling | No | No | No | Yes | Yes |
| Parallel workers | No | No | Yes, shared-worktree workers | No | Deferred to V2, isolated worktrees only |
| Project continuity | Yes, run artifacts | Yes, PRD and learnings | Partial; attempts/logs | Partial; PRD/logs/guardrails | Yes, explicit project state |
| Interactive mode | No | No | No | No | Yes |
| Autonomous / night mode | Yes | Yes | Yes | Yes | Yes, explicit opt-in |
| Morning handoff | No | No | No | No | Yes |

## MattMagg/ralph-wiggum-codex

### Repository overview and architecture

- Entry and Codex integration: `skills/ralph-wiggum-codex/scripts/ralph-loop-codex.sh` builds `codex exec -C <cwd> --output-last-message ... --output-schema ... --json` separately for a work phase and a review phase.
- Operating contract: `skills/ralph-wiggum-codex/SKILL.md` materializes `.codex/ralph-loop/` state, then requires fresh-context work followed by fresh-context review.
- The worker uses the configured sandbox; the reviewer is explicitly invoked with `read-only` in the main loop. `--dangerous` is opt-in and is only appended to the work command.

### Execution flow

1. Parse configuration and create a state directory, schemas, event log and a lock.
2. Reload objective, acceptance criteria and feedback from files each iteration.
3. Run a worker with a strict JSON schema; persist its work summary.
4. Run optional validation commands and save each command log.
5. Run a fresh reviewer with a separate JSON schema and read-only sandbox.
6. Accept completion only when worker status is `COMPLETE`, reviewer decision is `SHIP`, validation does not fail, and the Git progress gate is satisfied or explicitly justified.
7. Otherwise write feedback/history and continue, or stop for a confirmed blocker or an operational limit.

### State, failure handling and safety model

- `state.env`, objective/acceptance/feedback snapshots, `iteration-history.md`, JSONL/TSV events, per-phase JSONL output, validation logs, `work-summary.md`, and `review-feedback.md` provide resumable file-backed state.
- `run_phase_exec_with_watchdog` enforces hard and idle timeouts. `run_phase_with_retries` retries timeout-killed phases. The controller also stops at configured consecutive failure, stagnant-output, iteration, or stop-file thresholds.
- `.lock/meta.env` records PID/run metadata; stale locks are reclaimed only for a dead PID or with an explicit override.
- The Git integration only measures scoped uncommitted changes to reject unjustified no-op completion. It does not commit, rollback, or protect a PRD.

### Important implementation files

- `skills/ralph-wiggum-codex/scripts/ralph-loop-codex.sh`: runner, schemas, state persistence, timeout, lock, validation, worker/reviewer gate and stop reasons.
- `tests/smoke.sh`: source-level scenarios for review gating, validation failure, no-op rejection, timeout retry, lock recovery and resume.
- `skills/ralph-wiggum-codex/SKILL.md`: required artifacts and operating contract.

### License, strengths, weaknesses and reuse decision

- License: `LICENSE` is MIT. Modification and redistribution are permitted if the copyright and license notice are retained.
- Strengths: strongest completion gate; clear state artifacts; real reviewer isolation; practical timeout, stale-lock and resume handling.
- Weaknesses: Bash/POSIX-specific; validation is optional; no structured per-task failure memory, Git checkpoint, task-schema immutability, interactive mode, or morning handoff.
- Reuse: **ADAPT the design**, especially its work/review JSON contracts, state layout, lock protocol, stop reasons and reviewer gate. Do not copy the Bash runner into a cross-platform V1 without a deliberate portability decision.

## JH427/ralph-codex

### Repository overview and architecture

- Entry and loop: `ralph.py` is a compact Python controller. `main()` selects a branch from `prd.json`, loops over unfinished stories, and calls `run_story()`.
- Codex invocation: `run_codex()` starts a new `codex.cmd exec` process per attempt and supplies the PRD plus current learnings in the prompt.
- One story is attempted at a time. Completion requires an exact `DONE` line, a legal PRD transition, successful controller-run verification, and a Git commit.

### State, failure handling, safety and Git model

- State: `prd.json` holds stories and allowed `passes`/`notes` metadata; `learnings.md` is intended to be append-only.
- PRD protection: `validate_prd_changes()` rejects top-level changes, changed story order/IDs, changes to story requirements, multiple story edits, and illegal `passes` transitions. `validate_append_only()` rejects destructive or rewritten learnings.
- Verification: `run_tests()` executes `verify.py`; `verify.py` compiles `ralph.py` and invokes pytest.
- Git: the controller rejects a dirty repository, creates/checks out the PRD branch, commits the verified story, and uses `git reset --hard HEAD` plus `git clean -fd` on unsuccessful attempts.
- Failure handling: there are at most five attempts per story. There is no timeout, stall detector, structured failure memory, reviewer, rate-limit logic, or true run-resume state.

### Important implementation files

- `ralph.py`: Git helpers, PRD allowlist validation, Codex call, iteration/retry loop, test gate and commit.
- `verify.py`: the repository's canonical verification command.
- `prd.json` and `learnings.md`: the externalized task and continuity artifacts.

### License, strengths, weaknesses and reuse decision

- License: **UNVERIFIED for reuse**. The cloned root contains no `LICENSE`, `COPYING`, or `NOTICE` file. Do not copy code until the author provides a license.
- Strengths: the clearest field-level immutable-PRD protection; tiny, inspectable controller; test-before-commit discipline.
- Weaknesses: `DONE` is self-reported; no reviewer; verification is repository-specific; destructive rollback conflicts with this project's safety policy; no timeout/stall/resume support.
- Reuse: **ADAPT ideas only**: immutable task diff validation and append-only learnings. Reject its rollback implementation and do not copy unlicensed code.

## Yeine/ralph

### Repository overview and architecture

- Entry: `bin/ralph` sources the shell modules, parses options, selects `claude` or `codex`, then runs `run_loop` or `run_parallel`.
- Codex invocation: `lib/engine.sh` pipes prompt text to `codex exec <flags> --json -`, parses JSONL with `jq`, and records selected output markers.
- Each iteration re-reads the prompt file and starts a new agent invocation. `lib/iteration.sh` recognizes `PICKING:`, `DONE:`, `MARKING COMPLETE:`, `ATTEMPT_FAILED:`, and `EXIT_SIGNAL: true` from agent output.

### State, failure handling, safety and Git model

- State: `lib/attempts.sh` persistently records attempts and skipped tasks in `.ralph_attempts.json`; regular iteration count and history are in-process. Logs can be text or JSONL.
- Retry and failure: failed tasks increment their attempt count, then are skipped after `MAX_ATTEMPTS`. A skipped-task list is injected into later prompts.
- Timeout/stall: `lib/utils.sh` kills a process group on timeout; `lib/iteration.sh` treats excessive tool calls as failure; `lib/loop.sh` stops after consecutive `EMPTY`/`INFO` iterations.
- Parallelism: `lib/workers.sh` and `lib/claims.sh` create 1–16 concurrent workers, worker counter files and lock-protected task claims. The iteration prompt explicitly warns that workers are writing the same files concurrently.
- Git is only used by `get_file_state_hash()` in `lib/utils.sh` to detect changed status. There is no checkpoint, rollback or dirty-tree policy.
- No controller-run tests, independent reviewer, task/PRD immutability, rate-limit logic or durable full-run resume implementation was found.

### Important implementation files

- `bin/ralph`: configuration, mode selection, signal cleanup and sequential/parallel entry.
- `lib/engine.sh`: Codex/Claude execution and JSONL parsing.
- `lib/iteration.sh`: completion markers, task-attempt updates and event logging.
- `lib/attempts.sh`, `lib/lock.sh`, `lib/claims.sh`, `lib/workers.sh`: persistent failures, stale-lock handling and shared-worktree coordination.
- `lib/loop.sh`: max-iteration and non-productive stall exit.

### License, strengths, weaknesses and reuse decision

- License: `LICENSE` is MIT; retain its notice if code is reused.
- Strengths: practical process-group timeout cleanup, persistent task attempt tracking, user-facing logs, bounded stall exits, and real parallel coordination primitives.
- Weaknesses: completion comes from worker text markers; parallel workers share one worktree; no reviewer/verification gate; no durable project-state handoff; POSIX-only runtime.
- Reuse: **ADAPT the ideas** of process-group timeout, attempts and claims. Reject shared-worktree parallelism and do not make parallel workers part of V1.

## taberoajorge/ralph

### Repository overview and architecture

- Rust entry: `src/main.rs` loads a PRD/config, chooses the Codex/Claude/Cursor provider, and starts `src/loop_engine.rs`.
- Codex provider: `src/providers/codex.rs` starts a new `codex exec --dangerously-bypass-approvals-and-sandbox --json` child per story iteration, captures output, and delegates no-output detection to `src/detection/stall.rs`.
- The repository also has alternate provider scripts, including `scripts/ralph-codex.sh`. They implement their own loop, retry and rate-wait behavior. These scripts are separate runnable paths from the Rust binary; they must not be treated as identical implementations.

### State, failure handling, safety and Git model

- State: `src/prd.rs` persists `passes`, `blocked`, and notes in the PRD; `src/state.rs` supports `.ralph-pause` and `.ralph-done`; logs, guardrails and `failure_memory.json` are file-backed.
- Failure memory: `src/detection/failure_memory.rs` records per-story attempts, detects repeated approaches, bans repeated approaches and injects a diversity requirement into later prompts via `src/prompt.rs`.
- Failure handling: `src/loop_engine.rs` records spawn/nonzero/stall/zero-progress failures, blocks a story at its gutter threshold, and handles provider rate limits with an interruptible wait. The Codex provider detects repeated output but only logs the pattern; it does not use that signal to stop the child.
- Safety: malformed PRD files can be restored from a backup, but no allowlist validates semantically legal PRD changes. The default Codex provider bypasses both approvals and sandbox. Service configuration can run arbitrary start/stop shell commands.
- Verification: the TOML parser reads `[test].command` in `src/config.rs`, but `RalphConfig` never stores it and `src/loop_engine.rs` never runs it. Test enforcement therefore remains prompt-only in the inspected Rust runtime.
- Git: `src/git.rs` observes heads, diffs and commit counts and removes `.git/index.lock`; it does not create checkpoints or rollback. The alternate scripts likewise observe agent commits rather than creating controller-owned commits.
- Resume is partial: persistent PRD/failure artifacts, pause/done signals and provider-script rate-wait state survive; normal Rust iteration state is not saved before an interruption.

### Important implementation files

- `src/main.rs`, `src/loop_engine.rs`: main execution and story-selection loop.
- `src/providers/codex.rs`, `src/detection/stall.rs`: Codex launch and no-output watchdog.
- `src/detection/failure_memory.rs`, `src/prompt.rs`: persistent failure memory and diversity prompt.
- `src/prd.rs`, `src/state.rs`, `src/guardrails.rs`, `src/git.rs`: task state, pause/done, guardrails and Git observation.
- `scripts/ralph-codex.sh`: alternate shell runner with retries, stateful rate-limit waits and a stall watchdog.
- `skills/claude/SKILL.md` and `skills/cursor/SKILL.md`: operator guidance; no Codex-specific skill directory was present.

### License, strengths, weaknesses and reuse decision

- License: `LICENSE` and `Cargo.toml` declare MIT. Modification and redistribution are permitted with notice retention.
- Strengths: richest structured failure memory, useful rate-limit handling, service-health gate, guardrails and PRD backup restoration.
- Weaknesses: least-privilege boundary is unsafe by default; verification config is inert in Rust; no reviewer, PRD mutation validator, controller-owned Git checkpoint, full resume, interactive mode or human handoff.
- Reuse: **ADAPT the failure-memory and rate-limit designs**. Reject default approval/sandbox bypass, automatic service control, stale Git-lock deletion without validation, and prompt-only verification.

## KEEP / ADAPT / REJECT / MISSING

### KEEP

- File-backed, repository-local run artifacts and explicit stop reasons from MattMagg.
- Fresh worker and separate read-only reviewer process from MattMagg.
- Structured worker/reviewer output schemas and verification logs from MattMagg.
- Field-level task-spec immutability checks from JH427, implemented independently because its code is unlicensed.
- Persistent failure memory with diverse-next-attempt prompting from taberoajorge.
- Bounded timeout and process-tree cleanup principles from Yeine.

### ADAPT

- Git progress detection: track a baseline and scoped changes, but do not equate any change with task success.
- Git checkpoints: make them optional, only after reviewer and verification approval, and never reset/clean a user worktree automatically.
- Attempts/gutter handling: record the exact failed command, summary, changed paths and next human action; a limit must stop as `BLOCKED`, not silently skip work.
- Rate limits: preserve the provider retry timestamp and resume safely, with a capped retry budget.
- Locks: use an atomic run lock with PID/start metadata and explicit stale-lock recovery.

### REJECT

- Any default `--dangerously-bypass-approvals-and-sandbox`, `--yolo`, disabled sandbox, or arbitrary service-start command.
- `git reset --hard`, `git clean -fd`, destructive rollback, or unvalidated removal of Git lock files.
- Completion based only on an agent marker such as `DONE`/`EXIT_SIGNAL`.
- Parallel agents sharing one working tree. If parallelism is added later, each worker needs an isolated worktree/branch plus an integration gate.
- Treating prompt text that requests tests as controller-enforced verification.
- Direct reuse of JH427 source until a license is provided.

### MISSING ACROSS THE REFERENCES

- Explicit and safe Interactive ↔ Autonomous mode switching.
- A complete project-continuity model that preserves current state, decisions, failures and next actions for a new Codex context.
- A human handoff/morning report that identifies changes, evidence, unresolved risks and required acceptance checks.
- A single combined gate for immutable task requirements, objective evidence, independent review, validation and safe checkpoints.
- Cross-platform, least-privilege execution suitable for Codex users on Windows as well as POSIX systems.

## V1 Architecture Proposal — Approved for Implementation

### Recommendation

**Adapt existing designs; do not fork a reference implementation.** Build a small, cross-platform, repository-local Codex workflow orchestrator. The V1 implementation language should be Node.js/TypeScript, subject to approval, because Codex CLI already has a Node distribution and this avoids making Bash/POSIX a product requirement. No reference code needs to be copied for V1; MIT references are design and test-case sources, while JH427 remains ideas-only.

### V1 scope

1. One canonical task source: keep task requirements immutable; permit only execution metadata (`status`, `attempts`, `notes`, verification result) in a separate run-state file or a schema-validated metadata section.
2. Repository-local state under `.codex/workflow/`: `run-state.json`, `iteration-history.jsonl`, `failure-memory.json`, `work-result.json`, `review-result.json`, `validation/`, `events.jsonl`, lock metadata, and `BLOCKED.md`.
3. A worker/reviewer loop: worker runs with `workspace-write`; a new reviewer process runs with `read-only` and inspects the repository plus verification evidence.
4. Evidence-based completion: worker must report complete, configured verification must pass when present, reviewer must ship, and task-spec integrity must be confirmed. Otherwise emit `REVISE` or `BLOCKED`.
5. Bounded resilience: per-phase idle/hard timeouts, capped classified retries, failure memory, repeated-outcome stall detection, pause/stop signals, stale-lock recovery and an explicit resume command.
6. Human handoff: write `MORNING_REPORT.md`/task report with completed and blocked items, changed paths/commits, verification results, decisions made by the agent, and a short acceptance checklist.

### Mode behavior

| Mode | Selection | Iteration behavior | Stop behavior |
| --- | --- | --- | --- |
| Interactive (default) | User names one task | Worker, verification, reviewer, bounded fixes for that task | Update state/report and wait for the user; never select an unrelated next task |
| Autonomous / Night Shift | Explicit user command and runtime caps | Select only the next task from the immutable queue; worker, verify, review, checkpoint, record outcome | Continue until queue completion, caps, user stop, or a genuine blocker; then write the morning handoff |

### Safety and Git boundaries

- Default worker sandbox is `workspace-write`; reviewer sandbox is `read-only`. Dangerous approval/sandbox bypass is not a V1 option.
- Verification commands are declared before the run and their exact logs are retained. Absent verification is reported as `not configured`, never as a pass.
- Preserve a pre-existing dirty worktree. Never run reset, clean, force checkout, rebase, fetch, or destructive lock cleanup.
- Optional Git checkpoints are disabled by default; when enabled, they require a clean initial state and an accepted reviewer/verification gate. Failed work remains inspectable and is marked in state rather than discarded.
- The task source is diff-validated before/after each worker phase. Requirement fields cannot be silently rewritten.

### Deferred to V2

- Parallel workers, only with isolated worktrees and merge/integration review.
- Automatic service start/stop and environment orchestration.
- Provider abstraction beyond Codex CLI.
- Web dashboard, notifications and terminal UI.
- Automatic task decomposition or PRD generation.

### Approval outcome

The V1 boundary was approved on 2026-08-20. The implementation is a dependency-light Node.js/TypeScript CLI with immutable task documents, file-backed workflow state, separate Codex worker/reviewer phases, declared verification, failure memory, handoff reports, and opt-in Git checkpoints. Live Codex execution remains a separate integration acceptance step.
