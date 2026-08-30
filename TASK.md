TASK.md

Current Task

Post-release documentation — implement and verify complete English, Simplified Chinese, and Japanese README variants after studying stronger comparable Skill READMEs.

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

V1 `0.1.0` 已完成并公开发布：MIT release commit `3ebca15` 和 annotated `v0.1.0` tag 已推送至 `origin`。当前 README 改造已在不改变既有 tag 的前提下完成：`README.md` 为英文默认页，新增 `README.zh-CN.md` 与 `README.ja-JP.md`，三份文档具有对称语言切换、同一套安装/Quick Start/CLI/安全契约，并把同类 Skill README 的源码级调研结论写入 `RESEARCH.md`。文档链接/结构/关键命令检查、typecheck、build、wrapper help、70/70 tests 和包含三语文件的 72-entry pack dry-run 均通过。当前停止等待用户审阅；未经新授权不得 commit 或 push。
