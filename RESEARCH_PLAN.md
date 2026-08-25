RESEARCH_PLAN.md

Objective

在实现 Codex Workflow / Night Shift 之前，对现有自主 Coding Agent / Ralph 实现进行源码级研究。

原则：

«Existing implementation first. Reinvent only when necessary.»

---

Phase 1 — Acquire Repositories

至少获取以下 GitHub 仓库：

1. "MattMagg/ralph-wiggum-codex"
2. "JH427/ralph-codex"
3. "Yeine/ralph"
4. "taberoajorge/ralph"

将参考项目放入独立研究目录，例如：

research/
└── references/
    ├── ralph-wiggum-codex/
    ├── ralph-codex/
    ├── yeine-ralph/
    └── taberoajorge-ralph/

这些目录只用于研究，不要直接混入产品源码。

---

Phase 2 — Read Actual Source

禁止只根据 README 完成研究。

对每个项目至少检查：

Architecture

- 程序入口在哪里？
- Loop 谁负责？
- Agent 如何启动？
- 一个 iteration 如何定义？
- 是否 fresh context？
- Worker 和 Reviewer 是否分离？

State

检查：

- 当前任务保存在哪里？
- iteration 保存在哪里？
- restart 后如何恢复？
- context 如何传递？
- 是否依赖 Git？
- 是否存在 progress / learnings / state 文件？

Completion

检查：

- 谁判断 Done？
- Agent 是否可以自己宣布完成？
- 是否存在独立 reviewer？
- 是否执行 verification？
- completion signal 如何实现？

Failure

检查：

- retry
- timeout
- stall detection
- max attempts
- max iterations
- failure memory
- guardrails
- rate limit
- process crash
- stale lock
- resume

Git

检查：

- branch strategy
- commit strategy
- rollback
- checkpoint
- dirty working tree
- failed iteration 如何处理

Safety

检查：

- PRD 是否可修改？
- Agent 权限边界是什么？
- 是否存在 sandbox？
- 是否防止 destructive commands？
- 是否存在 resource limits？

Codex Integration

特别检查：

- Codex CLI 如何调用
- Codex Skill 如何组织
- "SKILL.md"
- "AGENTS.md"
- hooks
- config
- full-auto / approval / sandbox 设置
- context management

---

Phase 3 — Do Not Trust Documentation Alone

README 描述和真实代码可能不一致。

每个重要能力必须尽量找到对应实现位置。

例如：

Claim:
Supports stall detection

Evidence:
src/xxx.py
function: detect_stall()

如果 README 宣称存在某能力，但没有找到实现：

标记：

"UNVERIFIED"

不要当作事实写入最终架构。

---

Phase 4 — License Review

记录每个项目：

- License 类型
- 是否允许修改
- 是否允许再发布
- 是否要求 attribution
- 是否存在 copyleft 条件
- 哪些代码可以直接复用
- 哪些最好只借鉴设计

在没有确认 License 前，不要直接复制大量源码进入产品。

---

Phase 5 — Comparison Matrix

生成：

"RESEARCH.md"

至少比较：

Capability| MattMagg| JH427| Yeine| taberoajorge| Proposed
Codex Native| | | | | 
Fresh Context| | | | | 
Worker / Reviewer| | | | | 
Verification| | | | | 
Retry| | | | | 
Timeout| | | | | 
Stall Detection| | | | | 
Failure Memory| | | | | 
Guardrails| | | | | 
Resume| | | | | 
Git Checkpoint| | | | | 
PRD Protection| | | | | 
Rate Limit Handling| | | | | 
Parallel Workers| | | | | 
Project Continuity| | | | | 
Interactive Mode| | | | | 
Night Shift| | | | | 
Morning Handoff| | | | | 

每一个 ✓ 都应该能够追溯到源码或明确文档证据。

---

Phase 6 — Extract Best Ideas

不要直接开始编码。

先输出：

KEEP

我们直接采用的思想。

ADAPT

已有设计不错，但需要修改才能适合 Codex Workflow。

REJECT

研究过，但不适合我们的设计。

说明原因。

MISSING

所有参考项目都没有很好解决的问题。

重点关注：

- Interactive ↔ Autonomous Mode Switch
- Project Continuity
- Human Handoff
- Morning Report
- 人类如何保持对 AI 项目的认知
- 长时间 Agent 工作后的快速验收

---

Phase 7 — Architecture Proposal

完成源码研究后，再提出 V1 Architecture。

Architecture 必须回答：

1. 哪些能力直接复用？
2. 哪些能力借鉴后重写？
3. 哪些能力完全自己实现？
4. 为什么？
5. V1 最小范围是什么？
6. 哪些东西明确推迟到 V2？

在 Architecture Proposal 被确认之前：

不要开始大规模实现。