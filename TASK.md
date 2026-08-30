TASK.md

Current Task

Milestone 10 — V1 release closeout is complete locally under MIT. Remote publication awaits explicit push authorization.

权威规划文件：

- `PRODUCT_REQUIREMENTS.md`
- `ROADMAP.md`
- `RESEARCH.md`

---

Critical Instruction

M0–M9 已完成。V1 完成结论必须继续由真实 Codex worker、verification、reviewer、human accept/reject、Night dependency matrix 和第 17 节全部验收证据支撑，不得只引用自动化测试。

后续产品增强不得改写或弱化已通过的 V1 验收标准；如改变这些边界，必须新增相应回归和真实验收。

---

Stop Point

M0–M8、第一优先级 Skill packaging、第二优先级 readiness/user-path QA 和证据化项目记忆均已完成。最新自动化基线仍要求 `npm run typecheck`、`npm run build`、`npm test` 全部通过，测试总数为 70。M9 的 Session 0 根因、最小临时 GUI ACL 窗口和逐字节恢复机制已验证；没有修改持久系统配置。

根项目已建立 `main` 分支 Git 仓库，初始基线为 `382a857`；独立嵌套研究仓库与 M9 fixture 由父仓库忽略并保留内部历史。真实 Interactive accept/reject、Night dependency matrix、hard-timeout、reviewer `REVISE`、task-source mutation、stale lock、pause/stop/resume、verification failure、confirmed blocker、reviewer phase failure、total-runtime/max-tasks limits，以及 dirty Interactive、dirty Night 默认拒绝和 `--allow-dirty` Night 均已完成。最后 8 个场景的成功证据位于 `.m9-acceptance/final-matrix-20260829-f2/windows-v2`、`windows-v3`、`windows-v4`，可由 `verify-matrix.js` 重放断言；矩阵为 8/8，通过时任务源均未变化、锁已释放、调用无危险/Git bypass 参数、临时 Window Station/Desktop ACL 均恢复到基线，远端残留 fixture 进程为 0。M9 与 V1 第 17 节验收完成。

V1 `0.1.0` 发布收口已完成：新增 `CHANGELOG.md`、`RELEASE_CHECKLIST.md` 和 MIT `LICENSE`，README/ROADMAP/requirements/status 已对齐；两个 Skill 均通过官方 validator；wrapper help、pack dry-run、M9 8/8 证据重放、typecheck、build 和 70/70 tests 均通过。分发通道明确为 GitHub Codex Skill，npm package 保持 private。仓库所有者已授权并完成本地 release commit 与 annotated `v0.1.0` tag；尚未 push，因此远端仍未公开该版本。
