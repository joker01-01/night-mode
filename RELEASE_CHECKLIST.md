# V1 Release Checklist

## Release status

Version `0.1.0` is technically complete and has passed V1 functional acceptance. The repository owner selected MIT, authorized the release commit and annotated `v0.1.0` tag, then separately authorized their atomic push. Remote `main` and the peeled tag were verified at the same release commit.

No npm publication is planned. The supported distribution path is the GitHub Codex Skill installer documented in `README.md`; `package.json` remains private to prevent accidental npm publication.

## Completed technical checks

- [x] Version is consistently `0.1.0` in `package.json` and `package-lock.json`.
- [x] The package bin points to executable `scripts/night-mode`, not directly to build output.
- [x] The wrapper resolves the installed Skill root, installs locked build dependencies when missing, rebuilds stale output, and preserves the caller's target working directory.
- [x] A clean copied Skill without `node_modules` or `dist` bootstraps, builds, runs the full Interactive worker/verification/reviewer path, prints executable handoff commands, and accepts the provisional result.
- [x] Root user Skill and repository maintainer Skill have distinct scopes.
- [x] Both Skills pass the official Skill Creator `quick_validate.py` validator.
- [x] README covers install, readiness, Interactive/Night execution, limits, dirty worktrees, resume, status, accept/reject, evidence-backed memory, and safety boundaries.
- [x] `npm pack --dry-run --json` completes as a packaging diagnostic with 70 entries; required license/Skill/wrapper/source/docs are present and `.m9-acceptance/`, `research/references/`, and `node_modules/` are absent. npm is not the release channel.
- [x] `npm run typecheck`, `npm run build`, and `npm test` pass; the suite contains 70 tests.
- [x] `npm audit --json` reports zero known vulnerabilities across the locked dependency tree.
- [x] M9 controlled real-Codex acceptance is complete, with successful and failed diagnostic evidence retained under ignored `.m9-acceptance/` paths.
- [x] Acceptance fixtures and cloned research repositories remain ignored by the parent repository.
- [x] No release step requires dangerous sandbox bypass, destructive Git recovery, production deployment, payment, or credential changes.

## Research adoption status

### Absorbed into V1

- Repository-local file-backed state, fresh worker context, and a separate read-only reviewer.
- Immutable task requirements, deterministic dependency scheduling, structured worker/reviewer contracts, and controller-owned verification.
- Classified failure memory, repeated-outcome detection, bounded retries, idle/hard timeouts, pause/stop/resume, resource caps, and explicit stale-lock recovery.
- Git baseline separation and opt-in post-acceptance checkpoints without reset/clean/rollback.
- Human handoff, Morning Report, provisional completion, and explicit human acceptance/rejection.
- Factory-inspired deterministic readiness and artifact-backed user-path QA, adapted to a local controller with non-mutating bootstrap checks.
- GitHub-inspired citation-backed project memory, adapted to local evidence capture, SHA-256 revalidation, bounded retrieval, expiration, and audit retention.

### Valuable, intentionally deferred beyond V1

- Typed, default-off lifecycle hooks with explicit observe/block semantics.
- Phase-level checkpoint journal with input/output hashes and idempotency keys.
- Atomic live-steering inbox plus richer per-phase status, timing, and usage observability.
- Isolated-worktree parallelism with an integration queue and final cross-branch review.
- Hosted runtime adapters and a Mission Control UI after backend event contracts mature.

### Deliberately rejected

- Dangerous approval or sandbox bypass defaults.
- Destructive Git reset/clean/rollback or unvalidated Git-lock deletion.
- Completion based only on agent markers or prompt-requested tests.
- Parallel writers sharing one worktree.
- Automatic mutation of approved task/PRD requirements.
- Copying source whose reuse license is absent or unverified.

## Owner decisions

- [x] Select and add the MIT license.
- [x] Review the full V1 release scope, including new release files, source, and tests.
- [x] Authorize and create the local release commit.
- [x] Authorize and create the annotated `v0.1.0` tag.
- [x] Authorize and atomically push the commit and tag to `origin`; remote `main` and peeled `v0.1.0` were verified at `3ebca156cd484ef1fad664edcda3abd378bdab1e`.

## Release commands

The following commands document the completed release sequence. The commit and annotated tag were created locally, then `main` and `v0.1.0` were pushed atomically after separate owner authorization:

```text
git add <reviewed V1 files>
git commit -m "release: Night-Mode v0.1.0"
git tag -a v0.1.0 -m "Night-Mode v0.1.0"
git push --atomic origin main v0.1.0
```
