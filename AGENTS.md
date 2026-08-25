AGENTS.md

Project Mission

本项目目标是构建一套面向 Codex 的长期开发工作流系统。

它主要解决：

1. Project Continuity：跨会话、跨窗口保持项目状态。
2. Interactive Mode：白天 Human-in-the-loop 开发。
3. Autonomous / Night Shift Mode：无人值守持续开发。
4. Human Handoff：AI 长时间工作后，人类可以快速理解、验收和接管项目。

本项目不以“重新实现一个 Ralph Loop”为目标。

优先研究、复用和改造已有成熟方案，只开发现有方案没有解决好的部分。

---

Core Principle

Research Before Reinventing

禁止仅根据 README、搜索摘要、文章介绍或已有认知重新实现已有功能。

如果发现 GitHub 上已有相关实现：

1. 获取仓库。
2. 阅读真实源码。
3. 阅读配置文件。
4. 阅读 Prompt / Skill。
5. 阅读执行脚本。
6. 阅读状态管理方式。
7. 阅读停止条件和异常处理。
8. 确认 License。
9. 记录哪些设计可以复用。
10. 再决定是：

- 直接使用
- Fork / 修改
- 部分借鉴
- 自己实现

不要因为“自己写比较快”而跳过源码研究。

---

Reference Implementations

第一阶段至少研究以下项目：

- "MattMagg/ralph-wiggum-codex"
- "JH427/ralph-codex"
- "Yeine/ralph"
- "taberoajorge/ralph"

如果研究过程中发现更成熟或更相关的实现，可以加入候选列表。

Mandatory Rule

不要只打开 GitHub README 看。

必须尽可能把仓库 clone/download 到本地研究。

重点搜索：

- "AGENTS.md"
- "SKILL.md"
- prompts
- hooks
- scripts
- loop implementation
- state management
- retry logic
- timeout logic
- stall detection
- verification
- git handling
- context reset
- failure memory
- completion criteria
- resume/recovery
- logging

研究结果写入：

"RESEARCH.md"

---

Development Modes

INTERACTIVE

默认模式。

工作流程：

Task
→ Implement
→ Verify
→ Review
→ Update Project State
→ Report
→ STOP

完成一个合理的任务单元后停止并向用户报告。

不要未经用户允许自动扩展到下一个独立产品任务。

允许在当前任务内部自主：

- 修复测试
- 修复 lint
- 修复 type errors
- 小范围重构
- 补充必要测试
- 修复当前任务引入的 regression

---

AUTONOMOUS / NIGHT SHIFT

用户明确要求后才能进入。

工作流程：

Read State
→ Select Task
→ Work
→ Verify
→ Review
→ Checkpoint
→ Update State
→ Next Task
→ Repeat

直到：

- 达到验收标准
- 所有任务完成
- 达到资源/迭代限制
- 遇到 Hard Blocker

Night Shift 不因为完成单个任务而停止。

---

Safety

未经明确授权，不得：

- 删除大量现有代码
- 删除用户数据
- 修改生产环境
- 部署生产环境
- 进行付费操作
- 修改真实密钥
- 覆盖重要配置
- 强制 push
- 修改 Git 历史
- 为了让测试通过而降低验收标准

---

PRD Integrity

产品需求由人类定义。

AI 不得因为实现困难而偷偷修改需求。

如果未来存在机器可读任务文件，Agent 可以更新：

- status
- passes
- notes
- attempts
- verification result

但不得擅自改变需求本身的语义。

---

Git

Git 是安全机制，不只是版本控制。

自主模式下：

- 保持修改可恢复。
- 合理使用 checkpoint。
- 不把大量无关修改混入同一 checkpoint。
- 测试失败的状态不得伪装成完成。
- 不得通过破坏测试来制造 PASS。

---

Verification

“代码写完”不等于“任务完成”。

根据项目实际情况运行：

- tests
- lint
- typecheck
- build
- integration tests
- smoke tests
- UI verification

必须记录真实验证结果。

不得声称没有运行过的测试已经通过。

---

Failure Handling

同一问题反复失败时：

1. 保存失败原因。
2. 保存已经尝试的方法。
3. 下一次尝试必须读取历史失败。
4. 避免重复完全相同的方法。
5. 达到 failure threshold 后标记 BLOCKED。
6. Autonomous Mode 可以继续其他独立任务。

避免无限循环。

---

Project Memory

长期项目状态不能只存在于聊天上下文。

必须通过项目文件保存。

至少维护：

- "PROJECT_STATE.md"
- "RESEARCH.md"

后续实现 Night Shift 后可以增加：

- "LEARNINGS.md"
- "tasks.json"
- "failures.json"
- "run-state.json"
- "MORNING_REPORT.md"

---

V1 Runtime Conventions

- V1 is a Node.js/TypeScript CLI. Runtime code is in `src/`, compiled output is `dist/`, and focused tests are in `test/`.
- Use `npm run typecheck`, `npm run build`, and `npm test` for V1 verification.
- The immutable task source is a `workflow.tasks.json` document shaped like `workflow.tasks.example.json`. Execution metadata belongs only under `.codex/workflow/`.
- Interactive runs require one explicit `--task`; Night Shift requires explicit `--mode night`.
- Worker Codex phases use `workspace-write`; reviewer phases use `read-only`. Do not add dangerous approval or sandbox bypass flags.
- V1 does not pass Codex `--skip-git-repo-check`; every workflow target must be a Git working tree, including controlled smoke-test directories.
- Final V1 tasks use an immutable dependency DAG, require explicit acceptance criteria and verification commands, and may run only when all dependencies are automation-complete.
- Reviewer `SHIP` creates provisional completion only. Human `accept` is required for final completion; `reject` reopens the task and invalidates dependency descendants without rollback.
- Reviewer-approved structured state may update only the machine-managed section of `PROJECT_STATE.md`; preserve all human-owned content outside it.
- Night Shift must have total-runtime, task-count, and attempt limits. It rejects dirty worktrees by default; an explicit dirty override disables checkpoints and must preserve the starting baseline.
- Git checkpoints remain opt-in and may run only after an accepted review and non-failing declared validation. Never introduce reset, clean, rebase, fetch, or Git-lock deletion.
- The root repository ignores `.m9-acceptance/` and `research/references/` because they contain independent nested Git repositories; preserve their inner history rather than absorbing them as parent-repository gitlinks.

---

Change Discipline

不要为了“优化代码”进行与当前目标无关的大规模重构。

优先：

1. 最小必要修改
2. 可验证
3. 可恢复
4. 易理解
5. 易维护

重大架构变化先记录理由。

---

Documentation Discipline

当项目架构、关键决策、当前状态或下一步发生变化时，同步更新项目文档。

目标是：

即使当前 Codex 会话立即消失，一个新的 Codex 实例只读取仓库，也能够理解项目并继续工作。
