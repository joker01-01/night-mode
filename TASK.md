TASK.md

Current Task

Milestone 9 — End-to-End Acceptance Matrix is in progress.

权威规划文件：

- `PRODUCT_REQUIREMENTS.md`
- `ROADMAP.md`
- `RESEARCH.md`

---

Critical Instruction

M0–M8 的代码和自动化验证已经完成；不要把受控测试通过误报为 M9 完成。M9 必须记录真实 Codex worker、verification、reviewer、human accept/reject、Night dependency matrix 和第 17 节全部验收证据。

每完成一个独立验收单元，都必须验证、更新项目状态、报告并停止等待下一步。

---

Stop Point

M8 已通过，当前自动化基线为 `npm run typecheck`、`npm run build` 和 `npm test`，其中测试为 48/48 通过。M9 已确认原 runner 阻塞来自 Session 0 的非交互 Window Station/Desktop 未授予 `CodexSandboxOffline` 启动权限：runner 先以 `0xC0000142` 失败，15 秒 pipe timeout 只是下游症状。临时增加最小 GUI 对象 ACE 后，同一沙箱命令成功，随后原始安全描述符按 SHA-256 精确恢复。

根项目已建立 `main` 分支 Git 仓库，初始基线为 `382a857`；独立嵌套研究仓库与 M9 fixture 由父仓库忽略并保留内部历史。真实 Interactive accept、reject、Night dependency matrix、hard-timeout、reviewer `REVISE`、task-source mutation、stale lock 与 pause/stop/resume 单元均已完成。Pause/stop/resume fixture `.m9-acceptance/final-matrix-20260829-f1/pause-stop-resume-f3` 在 `PAUSE` 状态下收到 `STOP` 后以 `stopped/stop_file_detected` 安全结束，attempts 为 0 且未启动 Codex；显式 `resume` 后真实 worker、verification 和只读 reviewer 完整通过，proof 为精确 19 字节，任务停在 `provisionally_complete/awaiting_human_acceptance`，任务源未变化、锁已释放、无危险参数，临时 Session 0 ACL 恢复校验均为 True。`npm run typecheck`、`npm run build` 与 `npm test` 最新回归通过，测试为 48/48。M9 仍缺少 verification failure、confirmed blocker、phase failure、resource limits 和三种 dirty-worktree 行为的真实验收；自动化测试虽已覆盖这些分支，但在真实证据完成前不得宣称 M9 或 V1 完成。
