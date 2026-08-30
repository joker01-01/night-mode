# Night-Mode

[English](README.md) | **简体中文** | [日本語](README.ja-JP.md)

一个面向 Codex 的文件化、跨平台工作流控制器：既支持白天有人监督的开发，也支持有明确边界的自主 Night Shift。

`v0.1.0` · MIT · Node.js 22+ · Codex CLI · Windows / macOS / Linux

Night-Mode 会保持已批准需求不可变，让 worker 与 reviewer 每次都从新上下文启动，在 Agent 外部运行验证，持续保存项目状态，并把最终验收权交给人类。

## 为什么需要 Night-Mode

长期 AI 开发通常会在四个地方失控：跨会话上下文消失、Agent 过早宣称成功、无人值守时逐渐偏离目标，以及人类回来后无法快速理解改动。Night-Mode 把这些边界变成可执行规则：

- **项目连续性：** 仓库内状态、交接报告、失败记忆和带源码引用的项目记忆可以跨越全新的 Codex 上下文。
- **两种监督等级：** Interactive 只执行一个指定任务；Night Shift 只有在明确开启后，才会在总时长、任务数和尝试次数限制内持续工作。
- **先证据、后完成：** 控制器在 Agent 外运行声明的 verification 和带产物的 quality gate，再由独立只读 reviewer 返回 `SHIP`、`REVISE` 或 `BLOCKED`。
- **人类保留最终权力：** reviewer 的 `SHIP` 只是临时完成。只有 `accept` 才是最终人类验收；`reject` 会重开任务，但不会做破坏性回滚。

## 选择运行模式

| 模式 | 适用场景 | 行为 |
| --- | --- | --- |
| Interactive | 希望逐任务监督 | 执行一个明确指定的任务，完成验证、review 和交接后停止，等待人类验收。 |
| Night Shift | 明确希望进行有边界的无人值守开发 | 持续处理依赖已满足的任务，直到队列完成、出现 blocker、检测到 `STOP` 或达到资源上限。 |

Night Shift 默认最多运行 8 小时、每个运行片段处理 10 个任务、每个任务尝试 3 次。系统不会隐式进入 Night Shift。

## 环境要求

- Node.js 22 或更高版本。
- Git；每个工作流目标都必须是 Git working tree。
- 已安装、已登录且能够使用当前用户配置运行的 Codex CLI。
- 首次构建已安装 Skill 时需要 npm 或 pnpm。Night-Mode 永远不会自动运行目标项目声明的安装命令。

## 安装

将仓库根目录安装为 `night-mode` Codex Skill：

```text
python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo joker01-01/night-mode --path . --name night-mode
```

安装后重启 Codex。wrapper 位于已安装的 Skill 内：

```text
# macOS / Linux
node ~/.codex/skills/night-mode/scripts/night-mode help

# PowerShell
node "$HOME\.codex\skills\night-mode\scripts\night-mode" help
```

wrapper 会从自身位置解析安装目录，只在缺失时安装锁定的构建依赖，在 TypeScript 输出过期时重新构建，并始终把目标仓库保留为工作目录。

## 快速开始

### 1. 创建不可变任务文件

在目标 Git 仓库中复制示例文件，并把样例任务替换为具体需求：

```text
# macOS / Linux
cp ~/.codex/skills/night-mode/workflow.tasks.example.json workflow.tasks.json

# PowerShell
Copy-Item "$HOME\.codex\skills\night-mode\workflow.tasks.example.json" ".\workflow.tasks.json"
```

schema version 2 中的每个任务都必须包含唯一 `id`、明确 objective、显式 acceptance criteria、至少一个由控制器运行的 verification 命令，以及 `dependsOn` 数组。可选的 `qualityGates` 可以要求本次新生成的 integration 或 user-path 证据。

### 2. 检查 readiness

```text
node ~/.codex/skills/night-mode/scripts/night-mode readiness \
  --cwd /path/to/project --tasks workflow.tasks.json
```

检查 `READINESS.md`。Night Shift 默认要求 level 2；需要带产物的集成覆盖时选择 level 3，需要显式 bootstrap 假设和每个任务的 user-path QA 时选择 level 4。

### 3. 运行一个 Interactive 任务

```text
node ~/.codex/skills/night-mode/scripts/night-mode run \
  --cwd /path/to/project --tasks workflow.tasks.json --task example-001
```

控制器会启动全新的 `workspace-write` worker，执行声明的检查，再启动全新的 `read-only` reviewer，最后写入 `.codex/workflow/HANDOFF.md`。

### 4. 接受或拒绝临时完成结果

```text
node ~/.codex/skills/night-mode/scripts/night-mode accept \
  --cwd /path/to/project --task example-001

node ~/.codex/skills/night-mode/scripts/night-mode reject \
  --cwd /path/to/project --task example-001 --reason "说明需要修正的内容。"
```

如果配置了自定义 state directory，请使用 `HANDOFF.md` 中打印的精确命令。

## 直接作为 Skill 使用

可以让 Codex 操作已安装的 Skill，而不必自己拼接 CLI 参数：

```text
$night-mode
在 /path/to/project 使用 workflow.tasks.json 运行 Interactive 模式。
执行 example-001，然后停下来等待我验收。
```

需要自主运行时，请明确写出模式和限制：

```text
$night-mode
在 /path/to/project 使用 workflow.tasks.json 运行 Night Shift。
要求 readiness level 3，最多运行 2 小时或 5 个任务，并保留 Morning Report。
```

## Night Shift、停止与恢复

```text
# 启动有边界的 Night Shift。
node ~/.codex/skills/night-mode/scripts/night-mode run \
  --cwd /path/to/project --tasks workflow.tasks.json --mode night \
  --min-readiness 3 --total-runtime 7200 --max-tasks 5 --max-attempts 3

# 明确允许已有脏改动的目标；checkpoint 会被禁用。
node ~/.codex/skills/night-mode/scripts/night-mode run \
  --cwd /path/to/project --tasks workflow.tasks.json --mode night --allow-dirty

# 恢复中断或达到资源上限的运行。
node ~/.codex/skills/night-mode/scripts/night-mode resume \
  --cwd /path/to/project --tasks workflow.tasks.json --mode night

# 查看当前状态。
node ~/.codex/skills/night-mode/scripts/night-mode status --cwd /path/to/project
```

创建 `.codex/workflow/PAUSE` 可以阻止新 phase 启动；创建 `.codex/workflow/STOP` 会在最近的安全边界结束。Night Shift 退出前始终写入 `MORNING_REPORT.md`。

## Readiness 与证据

`readiness` 会在不启动 Codex 的情况下写入 `.codex/workflow/readiness.json` 和 `READINESS.md`。声明的 bootstrap install command 只是建议，控制器只允许运行有时间边界的 health check；如果该检查修改仓库，readiness 会失败。环境检查只记录变量名和是否存在，不记录值。

每个可选 quality gate 会声明一个 `integration` 或 `user_path` 命令和证据路径。exit code 0 仍然不够：每个产物必须是当前命令新建或刷新的普通文件。控制器会拒绝旧文件、symlink、逃逸路径、controller-owned 路径和过大文件，并为通过的证据记录大小与 SHA-256。

## 项目记忆

长期项目记忆与面向重试的失败记忆相互独立。经过 reviewer 批准的 decision、learning 和 constraint 会保存精确的仓库相对行引用与内容 hash。再次使用前，Night-Mode 会重新验证引用，自动定位唯一移动的文本，并排除已改变、存在歧义、缺失、过期或归档的记录，同时保留审计历史。

```text
node ~/.codex/skills/night-mode/scripts/night-mode memory list --cwd /path/to/project
node ~/.codex/skills/night-mode/scripts/night-mode memory validate --cwd /path/to/project
node ~/.codex/skills/night-mode/scripts/night-mode memory add --cwd /path/to/project \
  --kind learning --statement "API contract 位于 src/contracts.ts。" \
  --tags api,contracts --source src/contracts.ts:1-20
node ~/.codex/skills/night-mode/scripts/night-mode memory archive --cwd /path/to/project \
  --id memory-abc123 --reason "已由新 contract 取代。"
```

## 运行产物

Night-Mode 把执行元数据保存在不可变任务文件之外：

```text
.codex/workflow/
├── state.json                 # 运行、任务、依赖和资源限制状态
├── HANDOFF.md                 # 人类审查内容和精确下一步
├── readiness.json
├── READINESS.md
├── project-memory.json
├── PROJECT_MEMORY.md
├── failures.json              # 结构化重试历史
├── events.jsonl
├── phases/                    # worker/reviewer JSONL 输出
└── validation/                # verification 与 quality-gate 证据

PROJECT_STATE.md               # reviewer 批准的项目连续性
MORNING_REPORT.md              # Night Shift 汇总
```

## 安全保证

- Interactive 是默认模式；Night Shift 必须显式传入 `--mode night`。
- worker 使用 `workspace-write`；reviewer 使用 `read-only`。
- worker 不能自行完成任务。verification、reviewer 批准、未变化的任务 hash 和人类验收是彼此独立的门。
- Night Shift 默认拒绝脏工作树；只有显式 `--allow-dirty` 才可继续，且脏运行不能 checkpoint。
- Git checkpoint 默认关闭，只能在 review 接受且 validation 全部通过后创建。
- runner 不传入危险 approval 或 sandbox bypass 参数，也不使用 reset、clean、rebase、fetch、force push、Git 历史改写或未经校验的 Git lock 删除。
- 需求始终由人类拥有，执行状态不会修改 `workflow.tasks.json`。

## 开发与验证

```text
git clone https://github.com/joker01-01/night-mode.git
cd night-mode
npm ci
npm run typecheck
npm run build
npm test
node scripts/night-mode help
```

自动化测试共 70 项。V1 还通过了 [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) 定义的真实 Codex 受控验收矩阵，覆盖 Interactive accept/reject、Night 依赖、timeout、blocker、pause/stop/resume、任务源变化、stale lock、资源上限和脏工作树行为。

## 文档

- [V1 需求](PRODUCT_REQUIREMENTS.md)
- [路线图](ROADMAP.md)
- [调研与对比](RESEARCH.md)
- [更新日志](CHANGELOG.md)
- [发布检查清单](RELEASE_CHECKLIST.md)

仓库根目录是面向最终用户分发的 Skill；仓库维护说明被有意隔离在 `.agents/skills/night-mode-maintainer/SKILL.md`。

## 许可证

[MIT](LICENSE)
