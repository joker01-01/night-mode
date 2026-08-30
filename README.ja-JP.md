# Night-Mode

[English](README.md) | [简体中文](README.zh-CN.md) | **日本語**

Codex 向けの、ファイルベースかつクロスプラットフォームなワークフローコントローラーです。日中の人間監督型開発と、上限付きの自律的な Night Shift の両方を扱います。

`v0.1.0` · MIT · Node.js 22+ · Codex CLI · Windows / macOS / Linux

Night-Mode は、承認済み要件を不変に保ち、worker と reviewer を毎回新しいコンテキストで起動し、Agent の外側で検証を実行します。継続可能なプロジェクト状態を保存し、最終承認は人間に委ねます。

## Night-Mode が必要な理由

長時間の AI 開発は、主に四つの地点で破綻します。セッション間でコンテキストが失われる、Agent が早すぎる成功宣言をする、無人実行中に目的からずれる、そして人間が戻ったときに変更内容を短時間で理解できない、という問題です。Night-Mode はこれらを実行可能な境界に変えます。

- **プロジェクト継続性:** リポジトリ内の状態、handoff、failure memory、ソース引用付き project memory を、新しい Codex コンテキストでも引き継げます。
- **二つの監督レベル:** Interactive は指定された一つのタスクだけを実行します。Night Shift は明示的に有効化された場合に限り、総時間、タスク数、試行回数の上限内で継続します。
- **完了より先に証拠:** コントローラーが宣言済み verification と成果物付き quality gate を Agent の外で実行し、独立した read-only reviewer が `SHIP`、`REVISE`、`BLOCKED` を判断します。
- **人間の最終権限:** reviewer の `SHIP` は暫定完了にすぎません。最終完了には `accept` が必要で、`reject` は破壊的な rollback を行わずにタスクを再開します。

## モードを選ぶ

| モード | 適した場面 | 動作 |
| --- | --- | --- |
| Interactive | タスク単位で監督したい | 明示された一つのタスクを実行し、検証、review、handoff の作成後に停止して人間の承認を待ちます。 |
| Night Shift | 上限付きの無人進行を明示的に望む | 依存関係を満たしたタスクを、キュー完了、blocker、`STOP`、またはリソース上限まで処理します。 |

Night Shift の既定値は、総実行時間 8 時間、1 run segment あたり 10 タスク、1 タスクあたり 3 回の試行です。暗黙的に Night Shift へ切り替わることはありません。

## 必要環境

- Node.js 22 以降。
- Git。すべてのワークフロー対象は Git working tree である必要があります。
- インストール済みかつ認証済みで、現在のユーザー設定から利用できる Codex CLI。
- インストールした Skill の初回ビルド用 npm または pnpm。Night-Mode は対象プロジェクトの推奨 install command を自動実行しません。

## インストール

リポジトリのルートを `night-mode` Codex Skill としてインストールします。

```text
python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo joker01-01/night-mode --path . --name night-mode
```

インストール後に Codex を再起動してください。wrapper はインストール済み Skill 内にあります。

```text
# macOS / Linux
node ~/.codex/skills/night-mode/scripts/night-mode help

# PowerShell
node "$HOME\.codex\skills\night-mode\scripts\night-mode" help
```

wrapper は自身の場所からインストール先を解決し、不足時だけ lock 済みのビルド依存を導入し、古い TypeScript 出力を再ビルドします。対象リポジトリは常に作業ディレクトリとして維持されます。

## クイックスタート

### 1. 不変のタスクファイルを作る

対象 Git リポジトリでサンプルをコピーし、例示タスクを具体的な要件に置き換えます。

```text
# macOS / Linux
cp ~/.codex/skills/night-mode/workflow.tasks.example.json workflow.tasks.json

# PowerShell
Copy-Item "$HOME\.codex\skills\night-mode\workflow.tasks.example.json" ".\workflow.tasks.json"
```

schema version 2 の各タスクには、一意な `id`、明確な objective、明示的な acceptance criteria、コントローラーが実行する一つ以上の verification command、そして `dependsOn` 配列が必要です。任意の `qualityGates` では、今回新たに生成される integration または user-path の証拠を要求できます。

### 2. readiness を確認する

```text
node ~/.codex/skills/night-mode/scripts/night-mode readiness \
  --cwd /path/to/project --tasks workflow.tasks.json
```

`READINESS.md` を確認してください。Night Shift の既定要件は level 2 です。成果物付き integration coverage には level 3、明示的な bootstrap 前提と全タスクの user-path QA には level 4 を選択します。

### 3. Interactive で一つのタスクを実行する

```text
node ~/.codex/skills/night-mode/scripts/night-mode run \
  --cwd /path/to/project --tasks workflow.tasks.json --task example-001
```

コントローラーは新しい `workspace-write` worker を起動し、宣言済みチェックを実行してから、新しい `read-only` reviewer を起動し、`.codex/workflow/HANDOFF.md` を書き出します。

### 4. 暫定結果を承認または却下する

```text
node ~/.codex/skills/night-mode/scripts/night-mode accept \
  --cwd /path/to/project --task example-001

node ~/.codex/skills/night-mode/scripts/night-mode reject \
  --cwd /path/to/project --task example-001 --reason "修正が必要な内容を説明します。"
```

独自の state directory を設定した場合は、`HANDOFF.md` に表示される正確なコマンドを使用してください。

## Skill として直接使う

CLI 引数を自分で組み立てず、インストール済み Skill の操作を Codex に依頼できます。

```text
$night-mode
/path/to/project で workflow.tasks.json を使い、Interactive モードを実行してください。
example-001 を処理したら、私の承認を待って停止してください。
```

自律実行では、モードと上限を明示します。

```text
$night-mode
/path/to/project で workflow.tasks.json を使い、Night Shift を実行してください。
readiness level 3 を要求し、2 時間または 5 タスクで停止し、Morning Report を残してください。
```

## Night Shift、停止、再開

```text
# 上限付き Night Shift を開始します。
node ~/.codex/skills/night-mode/scripts/night-mode run \
  --cwd /path/to/project --tasks workflow.tasks.json --mode night \
  --min-readiness 3 --total-runtime 7200 --max-tasks 5 --max-attempts 3

# 既に dirty な対象を明示的に許可します。checkpoint は無効になります。
node ~/.codex/skills/night-mode/scripts/night-mode run \
  --cwd /path/to/project --tasks workflow.tasks.json --mode night --allow-dirty

# 中断または limit 到達後の run を再開します。
node ~/.codex/skills/night-mode/scripts/night-mode resume \
  --cwd /path/to/project --tasks workflow.tasks.json --mode night

# 現在の状態を確認します。
node ~/.codex/skills/night-mode/scripts/night-mode status --cwd /path/to/project
```

`.codex/workflow/PAUSE` を作成すると新しい phase の開始を止められます。`.codex/workflow/STOP` を作成すると、直近の安全な境界で終了します。Night Shift は終了前に必ず `MORNING_REPORT.md` を書きます。

## Readiness と証拠

`readiness` は Codex を起動せずに `.codex/workflow/readiness.json` と `READINESS.md` を書きます。宣言された bootstrap install command は助言にすぎません。実行可能なのは時間制限付き health check だけで、そのチェックがリポジトリを変更すると readiness は失敗します。環境確認は変数名と存在だけを記録し、値は保存しません。

各 quality gate は `integration` または `user_path` command と証拠パスを宣言します。exit code 0 だけでは合格しません。すべての成果物は今回の command が新規作成または更新した通常ファイルである必要があります。古いファイル、symlink、リポジトリ外への escape、controller-owned path、過大なファイルは拒否され、承認した証拠には size と SHA-256 を記録します。

## プロジェクトメモリ

長期的な project memory は、retry 用 failure memory とは別です。reviewer が承認した decision、learning、constraint は、正確なリポジトリ相対行引用と content hash を保持します。再利用前に Night-Mode が引用を再検証し、一意に移動したテキストは再配置します。変更、曖昧、欠落、期限切れ、archive 済みの記録は worker から除外されますが、監査履歴から削除されません。

```text
node ~/.codex/skills/night-mode/scripts/night-mode memory list --cwd /path/to/project
node ~/.codex/skills/night-mode/scripts/night-mode memory validate --cwd /path/to/project
node ~/.codex/skills/night-mode/scripts/night-mode memory add --cwd /path/to/project \
  --kind learning --statement "API contract は src/contracts.ts にあります。" \
  --tags api,contracts --source src/contracts.ts:1-20
node ~/.codex/skills/night-mode/scripts/night-mode memory archive --cwd /path/to/project \
  --id memory-abc123 --reason "新しい contract に置き換えられました。"
```

## 実行成果物

Night-Mode は実行メタデータを不変のタスクファイルとは別に保存します。

```text
.codex/workflow/
├── state.json                 # run、task、dependency、limit の状態
├── HANDOFF.md                 # 人間向け review と正確な次の操作
├── readiness.json
├── READINESS.md
├── project-memory.json
├── PROJECT_MEMORY.md
├── failures.json              # 構造化された retry 履歴
├── events.jsonl
├── phases/                    # worker/reviewer の JSONL 出力
└── validation/                # verification と quality-gate の証拠

PROJECT_STATE.md               # reviewer 承認済み project continuity
MORNING_REPORT.md              # Night Shift の要約
```

## 安全保証

- Interactive が既定です。Night Shift には明示的な `--mode night` が必要です。
- worker は `workspace-write`、reviewer は `read-only` を使います。
- worker 自身はタスクを完了にできません。verification、reviewer 承認、不変の task hash、人間の承認は独立した gate です。
- Night Shift は既定で dirty worktree を拒否します。明示的な `--allow-dirty` の場合のみ続行でき、dirty run は checkpoint を作れません。
- Git checkpoint は既定で無効です。review が受理され、validation がすべて成功した後にだけ作成できます。
- runner は危険な approval や sandbox bypass flag を渡さず、reset、clean、rebase、fetch、force push、履歴書き換え、未検証の Git lock 削除を使いません。
- 要件は常に人間が所有します。実行状態が `workflow.tasks.json` を変更することはありません。

## 開発と検証

```text
git clone https://github.com/joker01-01/night-mode.git
cd night-mode
npm ci
npm run typecheck
npm run build
npm test
node scripts/night-mode help
```

自動テストは 70 件あります。V1 は [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) で定義された実 Codex の管理下 acceptance matrix にも合格しています。Interactive accept/reject、Night dependency、timeout、blocker、pause/stop/resume、task mutation、stale lock、resource limit、dirty-worktree behavior を含みます。

## ドキュメント

- [V1 要件](PRODUCT_REQUIREMENTS.md)
- [ロードマップ](ROADMAP.md)
- [調査と比較](RESEARCH.md)
- [変更履歴](CHANGELOG.md)
- [リリースチェックリスト](RELEASE_CHECKLIST.md)

リポジトリのルートはエンドユーザー向けに配布する Skill です。リポジトリ保守用の指示は `.agents/skills/night-mode-maintainer/SKILL.md` に意図的に分離されています。

## ライセンス

[MIT](LICENSE)
