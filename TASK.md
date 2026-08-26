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

根项目已建立 `main` 分支 Git 仓库，初始基线为 `382a857`；独立嵌套研究仓库与 M9 fixture 由父仓库忽略并保留内部历史。真实 Interactive accept、reject、Night dependency matrix、hard-timeout、reviewer `REVISE`、task-source mutation 与 stale lock 单元均已完成。Stale-lock fixture `.m9-acceptance/stale-lock-20260826-l1` 从干净 Git 基线验证活动锁拒绝、死锁默认拒绝和显式回收：前两次均 exit 1 且锁 hash 不变；显式 `--reclaim-stale-lock` 后真实 worker、verification 和只读 reviewer 完整通过，任务停在 `provisionally_complete/awaiting_human_acceptance`，任务源未变化、锁已释放、无 checkpoint、危险参数或残留进程，临时 Session 0 ACL 恢复校验均为 True。下一步执行 pause/stop safe-boundary 独立验收单元；不得重复已通过单元，也不得在剩余证据完成前宣称 M9 或 V1 完成。
