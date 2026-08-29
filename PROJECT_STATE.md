PROJECT_STATE.md

Current Stage

Final V1 requirements and delivery roadmap are complete. Milestones 0 through 8 passed; Milestone 9 is in progress. Real Interactive accept/reject, the bounded Night dependency matrix, and pause/stop/resume passed; the remaining section 17 acceptance scenarios are still outstanding.

当前 `0.1.0` 实现已通过本地测试，并修复 Windows PowerShell UTF-8 BOM、全局 npm Codex 启动和 Codex 严格 structured-output schema 的兼容问题。M0 的真实 PowerShell Interactive 基线已通过：worker 成功、声明的 verification 通过、只读 reviewer 返回 `SHIP`，并生成证明文件和 handoff。

M1 已完成：任务文档升级为 schemaVersion 2；每个任务必须声明非空 acceptanceCriteria、verification 和显式 dependsOn；控制器拒绝旧 schema、重复/未知/自依赖/循环依赖；运行状态分离 automationStatus 与 humanAcceptanceStatus，并定义 provisional、rejected、dependency_blocked、limit_reached 状态和非法转移保护；worker/reviewer 支持结构化 project-state proposal/review 合同。

M1 验证：`npm run typecheck` 通过；`npm test` 通过，14/14 tests passed。

M2 已完成：所有新运行先执行 Git preflight；状态保存初始 commit、status、changed paths 和 baseline hash；非 Git 目录被拒绝；Interactive dirty worktree 会 warning 并记录 baseline；Night dirty worktree 默认拒绝，`--allow-dirty` 明确开启后保留 baseline 但禁用 checkpoint；phase-launch failure 包含 primary cause 和 phase log 路径。

M2 验证：`npm run typecheck` 通过；`npm test` 通过，20/20 tests passed；CLI help 已显示 `--allow-dirty`。

M3 已完成：Night scheduler 只选择依赖全部 automation-complete 的任务，并按任务文档顺序运行；task blocker 会传递为后代的 `dependency_blocked`，独立任务继续运行；Interactive 对未满足依赖停止并记录每个依赖的状态；phase/runtime blocker 与 task blocker 分开处理，global blocker 会停止 run。

M3 验证：`npm run typecheck` 通过；`npm test` 通过，25/25 tests passed。

M4 已完成：完成门现在只接受 schema-valid worker `COMPLETE`、reviewer `SHIP`、所有声明 verification 命令通过且 task source hash 未变化；`not_configured` 和 worker 单独 COMPLETE 都不会完成任务。失败记忆和 task state 记录 phase、classification、exit/timeout、精确日志、相对 run baseline 的 changed paths、worker/reviewer/verification 证据、primary cause 和 next action；重复 outcome 会要求 materially different retry。Handoff 直接展示失败主因和证据路径。

M4 验证：`npm run typecheck` 通过；`npm test` 通过，31/31 tests passed。新增受控 fake Codex 测试覆盖 false completion、missing/failed verification、reviewer revise/block、malformed output 和 repeated outcomes。真实 Codex 端到端验收仍属于后续 M9，不在本次 M4 声称完成。

M5 已完成：新增 `accept --task <id>` 和 `reject --task <id> --reason <text>`。Accept 将 `provisionally_complete/awaiting_human_acceptance` 变为最终 human `accepted`；reject 将任务重开为 `pending/rejected`，记录人类原因，清空本轮 stall signature，并把所有传递后代设为 `dependency_blocked`，不删除 phase、validation、failure 或 checkpoint 证据。重复 accept/reject 是幂等的；已最终接受的任务不能再 reject；交互运行在等待接受时保持 `needs_review`。

M5 验证：`npm run typecheck` 通过；`npm test` 通过，36/36 tests passed。覆盖 Interactive provisional stop、accept、reject、原因、后代失效、证据保留、最终决策错误和 CLI 命令。

M6 已完成：worker 必须提交结构化 project-state proposal，reviewer 必须提交 `APPROVE` 或 `CORRECT` 的 project-state review；只有完成门通过后才会把 reviewer 认可的提案写入运行状态。控制器通过 `<!-- codex-workflow:managed:start -->` / `<!-- codex-workflow:managed:end -->` 标记原子创建或替换 `PROJECT_STATE.md` 托管区，托管区外的人工内容按字节保留。临时完成、accept、reject、blocker、stop 和运行结束都会同步可继续工作的状态、决策、证据、风险和下一步；没有 reviewer 提案时使用诚实的 controller summary。

M6 验证：`npm run typecheck` 通过；`npm test` 通过，40/40 tests passed。覆盖 proposal/review 合同、完成门、托管区创建与替换、人工内容字节保留、损坏标记拒绝、fresh-context 信息读取、临时完成、accept、reject、blocker 和 stop 生命周期。

M7 已完成：Night Shift 现在具有 8 小时总运行时长、最多 10 个任务、每任务最多 3 次尝试的 CLI 默认上限；运行状态持久化当前预算、已处理任务、目标目录和 limit-reached 状态。总时长会在暂停期间和 worker、verification、reviewer 之间检查；`PAUSE` 期间仍响应 `STOP`。任务尝试上限产生 `limit_reached` 而不是 blocker，资源上限会保留可恢复状态并生成 `MORNING_REPORT.md`。恢复会重置本次运行片段预算、重新打开可重试的 limit task，并记录中断后 phase 重跑原因；resume 还会校验目标目录、任务文件路径和 hash。锁元数据现在包含 PID、时间、run ID、target 和 command context；死锁必须显式 `--reclaim-stale-lock` 回收，活动锁不能被回收。

M7 验证：`npm run typecheck` 通过；`npm test` 通过，45/45 tests passed。覆盖总时长、最大任务数、最大尝试数、暂停到停止、显式死锁恢复、任务/运行 limit 状态、resume 边界和中断 phase 重跑记录。

M8 已完成：checkpoint 仅在自动化完成、验证通过且初始 worktree clean 时创建；machine-state 文件不进入 checkpoint；handoff 和 Morning Report 分开展示任务结果、决策、证据、风险、依赖、限制和人类动作；拒绝 provisional checkpoint 不回滚已有工作。

M8 验证：`npm run typecheck` 通过；`npm test` 通过，48/48 tests passed。

Skill packaging follow-up：根目录新增符合 Codex Skill 规范的 `SKILL.md`，并增加 Skill contract 测试；Windows 全局 npm Codex 路径解析改用 Windows 路径语义。当前自动化回归为 49/49 tests passed；M9 的真实验收范围和未完成状态不变。

M9 进行中：Session 0 runner 根因已确认是非交互 Window Station/Desktop 缺少沙箱账户 bootstrap 权限；最小临时 ACE 可恢复执行，且每次结束均恢复原安全描述符，没有修改持久系统配置。真实 Interactive accept 已完成 worker、verification、reviewer 和用户显式 accept，证据位于 `C:\\Users\\ADMIN\\AppData\\Local\\Temp\\codex-workflow-m9-recovered-20260823-a1`。真实 reject fixture 固定了 `real-reject -> reject-child -> reject-grandchild` 三层 DAG；用户明确拒绝后，父任务变为 `pending/rejected`，child 与 grandchild 均为 attempts 0/`dependency_blocked`，proof、日志和 Git 变化全部保留，证据位于 `C:\\Users\\ADMIN\\AppData\\Local\\Temp\\codex-workflow-m9-reject-20260823-r1`。真实 Night dependency matrix 已在 `.m9-acceptance/night-dependency-20260824-n4` 通过：`night-root -> night-child -> night-independent -> night-grandchild` 按文档顺序各执行一次，4 个 worker 均在 `workspace-write`、4 个 reviewer 均在 `read-only`，所有 verification exit 0、reviewer `SHIP`、project-state review `APPROVE`，最终全部停在 `provisionally_complete/awaiting_human_acceptance`；Morning Report 无 blocker、limit 或 checkpoint。任务源 SHA-256 未变化，4 个 proof 字节精确匹配。运行使用官方 `windows.sandbox_private_desktop=false` 兼容开关与可恢复 Session 0 ACL 窗口，结束后 Window Station/Desktop 原安全描述符 SHA-256 均精确恢复。真实 hard-timeout 单元已在 `.m9-acceptance/timeout-20260825-t1` 通过：干净 Git fixture 使用默认真实 Codex launcher，worker 在约 1 秒后记录 `phase_timeout`/`timedOut=hard`/exit `-1`，随后因单次尝试上限诚实结束为 `limit_reached/task_attempt_limit_reached`；verification 与 reviewer 均未启动，proof 未生成，任务源 hash 未变化，workflow lock 已释放，无残留 fixture 进程或危险参数，handoff 保留精确日志。Session 0 ACL 结束后两项安全描述符恢复校验均为 True。真实 reviewer `REVISE` 单元已在 `.m9-acceptance/reviewer-revise-20260826-r1` 通过：干净 Git 基线 `ba91f31` 上由 harness 仅合成未改仓库的 worker `COMPLETE`，粗粒度 existence verification exit 0，真实 reviewer 在 `read-only` 中读取到 proof 仍为 `WRONG\n` 并返回 `REVISE`，project-state review 为 `CORRECT`；控制器记录 `review_revise` 后因 `--max-attempts 1` 诚实结束为 `limit_reached/task_attempt_limit_reached`。Proof 与任务源 SHA-256 均未变化，workflow lock 已释放，无残留 fixture 进程或危险参数，Session 0 Window Station/Desktop ACL 恢复校验均为 True。Night matrix、timeout 与 reviewer REVISE 单元通过，但其余第 17 节场景仍未完成。
根项目已初始化为 `main` 分支 Git 仓库，初始干净基线为 `382a857`（`chore: establish project baseline`）。父仓库只跟踪产品源码、测试和项目文档；`.m9-acceptance/` 与 `research/references/` 因包含独立嵌套 Git 仓库而保留内部历史并由父仓库忽略。真实 task-source mutation 单元已在 `.m9-acceptance/task-mutation-20260826-m1` 通过：干净 Git 基线 `c55e039` 上启动真实 Codex worker，harness 在 `workspace-write` phase 开始后把任务源 SHA-256 从 `00D4531B...DAFC5` 改为 `B85E158C...3F7A`；worker 仅只读确认 proof 并返回 schema-valid `COMPLETE`，proof SHA-256 保持 `F6FAA555...3F83`。控制器在 worker exit 0 后、validation/reviewer 启动前检测到不可变任务源变化，记录 `controller/task_source_mutated` 并诚实结束为 `blocked/task_source_mutated`；任务源 Git diff 仅改变 title 一行，workflow lock 已释放，handoff 与 failure memory 完整，无残留 fixture 进程或危险参数，Session 0 Window Station/Desktop ACL 恢复校验均为 True。

真实 stale-lock 单元已在 `.m9-acceptance/stale-lock-20260826-l1` 通过：干净 Git 基线 `a421182` 上，活动 PID 锁与不存在 PID 的死锁在未授权时均 exit 1 且 metadata SHA-256 前后相同；默认死锁错误明确要求 `--reclaim-stale-lock`。显式回收后真实 Codex worker 在 `workspace-write` 创建精确 `STALE_LOCK_RECOVERED\n` proof，声明 verification exit 0，真实 `read-only` reviewer 返回 `SHIP` 且 project-state review `APPROVE`，任务停在 `provisionally_complete/awaiting_human_acceptance`；任务源 hash 未变化，controller-owned `.lock` 已释放，无 checkpoint、危险参数或残留进程，Session 0 Window Station/Desktop ACL 恢复校验均为 True。fixture 开发期间的仓库所有者差异使用仅对子进程生效的 `safe.directory` 解决，错误锁路径尝试完整归档于 `.codex/acceptance-attempts/wrong-lock-path`，未修改全局 Git 配置或产品代码。

真实 pause/stop/resume 单元已在 `.m9-acceptance/final-matrix-20260829-f1/pause-stop-resume-f3` 通过：Night 控制器在 `PAUSE` 存在时持续检查边界，写入 `STOP` 后以 `stopped/stop_file_detected` 结束，任务 attempts 保持 0、未启动 Codex phase，并写入 state 与 handoff。移除两个控制文件后显式 `resume`，真实 worker 在 `workspace-write` 创建精确 19 字节 `PAUSE_STOP_RESUMED\n` proof，声明 verification exit 0，真实 `read-only` reviewer 返回 `SHIP`，project-state review 为 `CORRECT`，最终停在 `provisionally_complete/awaiting_human_acceptance`。任务源 hash 未变化，controller-owned `.lock` 已释放，worker/reviewer 参数不含危险或 Git bypass 选项；本次仅对子进程使用官方 `unelevated` Windows sandbox fallback 与 `windows.sandbox_private_desktop=false` 兼容开关，Session 0 Window Station/Desktop ACL 结束后恢复校验均为 True。失败尝试 f1/f2 已保留，分别记录 elevated sandbox 的 `0xC0000142` 子进程初始化失败，以及早期验收 driver 的 Windows 命令引用/600 秒预算错误。

---

Problem

长期使用 AI Coding Agent 开发项目时存在几个核心问题：

1. Context discontinuity

新的窗口 / context 不知道：

- 项目做到哪里
- 为什么这样设计
- 哪些方案已经试过
- 哪些坑已经踩过
- 下一步应该做什么

2. Human cognitive disconnect

AI 可以快速产生大量代码，但人类开发者可能逐渐不知道：

- AI 修改了什么
- 为什么这么修改
- 当前架构是什么
- 哪些地方存在风险
- 自己应该验收什么

3. Supervision level

白天开发与无人值守开发需要不同监督等级。

白天：

Task
→ Work
→ Verify
→ Report
→ Human Review
→ Next Task

夜间：

Task
→ Work
→ Verify
→ Review
→ Checkpoint
→ Next Task
→ ...
→ Morning Report
→ Human Review

现有 Ralph 类项目主要解决第二种循环，但不一定很好解决两种模式之间的切换和人类重新接管。

---

Current Product Direction

已确认产品方向：

Codex Development Workflow

核心能力：

Project Continuity

让不同 Codex context 可以继续同一个项目。

Interactive Mode

默认白天工作模式。

完成一个任务单元以后：

- 验证
- 更新状态
- 报告
- 等待用户

Autonomous / Night Shift Mode

用户明确开启。

Agent 可以：

- 自主选择下一任务
- 实现
- 测试
- review
- retry
- checkpoint
- 更新状态
- 继续下一项

直到达到停止条件。

Human Handoff

长时间自主工作结束后，让用户在几分钟内知道：

- 做了什么
- 没做什么
- 为什么
- 测试情况
- 哪些失败
- 哪些决定是 AI 自己做的
- 用户应该重点验收什么

---

Reference Projects

必须源码级研究：

- MattMagg/ralph-wiggum-codex
- JH427/ralph-codex
- Yeine/ralph
- taberoajorge/ralph

详见：

"RESEARCH_PLAN.md"

---

Approved V1 Architecture

源码研究支持以下方向：

- 不 fork 任一参考实现；采用现有设计中的可验证机制，做跨平台的 Codex 工作流编排层。
- 直接吸收 fresh context、独立 reviewer、验证 gate、超时/停滞保护、failure memory、锁与可恢复状态。
- 需要自行补足并作为产品重点的能力：Project Continuity、Interactive / Autonomous mode switching、Human Handoff、Morning Report 和人类认知同步。
- 不采用默认危险权限、共享 worktree 并行、仅凭 agent 宣称完成、destructive Git rollback，或无许可代码复用。

完整的源码证据、能力矩阵和已批准 V1 architecture 见 `RESEARCH.md`。

---

Current Next Step

1. M9 尚未完成。下一批未完成的真实验收为：verification failure、confirmed blocker、phase failure、resource limits，以及 dirty Interactive、默认拒绝 dirty Night、显式 `--allow-dirty` Night。自动化测试已覆盖这些分支，但不能替代第 17 节真实验收。
2. 保留 `.m9-acceptance/night-dependency-20260824-n4`、`.m9-acceptance/timeout-20260825-t1`、`.m9-acceptance/reviewer-revise-20260826-r1`、`.m9-acceptance/task-mutation-20260826-m1`、`.m9-acceptance/stale-lock-20260826-l1` 与 `.m9-acceptance/final-matrix-20260829-f1/pause-stop-resume-f3` 的状态、phase 日志和 handoff，不代替人类执行 accept/reject。
3. 后续真实 Codex 场景继续使用 Session 1，或使用同一可恢复 Session 0 ACL 窗口与官方私有 Desktop 兼容开关；每次核验并恢复 GUI 对象 DACL，不修改永久代理、模型缓存或系统安全配置。

---

Important

当前阶段最危险的错误是把单次 Night dependency matrix 通过误报成第 17 节全部场景或最终 V1 完成。

当前主要风险是遗漏第 17 节剩余真实运行场景；M9 在清单逐项完成前仍未通过。
