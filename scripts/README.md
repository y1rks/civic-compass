# scripts/

このリポジトリのスクリプトは、性格の違う2つのグループに分かれます。

| グループ | 場所 | いつ走るか |
|---|---|---|
| **デプロイ用** | `scripts/*.mjs` | GitHub Actions が自動で実行。**手で叩く必要は基本ない** |
| **データ構築用** | `scripts/kokkai/` | **人が手で実行する**。議員プロファイルの元データを作る |

前者は CI に組み込み済みで、後者は「作るときに1回」「直したいときにやり直す」種類のものです。
この違いを押さえておくと、どれを実行すべきか迷いません。

---

## デプロイ用（CI が自動実行）

`.github/workflows/deploy.yml` から呼ばれます。**ローカルで実行する必要はありません。**
CI が落ちたとき、原因を手元で再現するために叩くことはあります。

### `validate-cloudflare-deploy.mjs`

デプロイ前に設定の不備を止めます。

- `api/wrangler.jsonc` の `database_id` がプレースホルダのままでないか
- UUID の形式になっているか
- GitHub Actions 上なら `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` が設定されているか

**デプロイしてから気づくと復旧が面倒な種類のミス**を、事前に落とすためのものです。

### `migrate-d1-remote.mjs`

本番の D1 にマイグレーションを適用します（`npm run db:migrate:remote` のラッパー）。

`db/migrations/` に `.sql` が1つもなければ何もせず終了します。
スキーマを作る前でも CI が落ちないようにするためです。

### `smoke-test.mjs`

デプロイ後、実際に動いているかを外から確認します。

- `/` が 200 を返すか
- `/api/health` が `{ status: "ok", database: "connected" }` を返すか

環境変数 `CIVIC_COMPASS_PUBLIC_URL` が必要です。
**D1 バインディングの設定ミスは、デプロイ自体は成功してしまう**ので、ここで捕まえます。

---

## データ構築用（人が実行）

`scripts/kokkai/` は【1】utterances を作るためのパイプラインです。
**詳細は [kokkai/README.md](kokkai/README.md) を読んでください。**ここでは全体像と実行順だけ示します。

```
国会会議録API ──→ collect.mjs     ──→ data/raw/
議員の公式サイト ─→ fetch-web.mjs   ──→ data/raw_web/
手打ちテキスト ──→（手で置く）     ──→ data/manual/
                        │
                  preprocess.mjs
                        ↓
                  data/clean/  ← LLM 分割・抽出の入力
                        │
                  segment分割 → フレーム抽出（LLM）
                        ↓
                 【1】utterances → export-d1.mjs → D1
```

### 実行の順序と頻度

| # | スクリプト | いつ実行するか | 再実行して安全か |
|---|---|---|---|
| 1 | `collect.mjs` | **最初に1回**（全15人で15〜25分） | 既存ファイルはスキップ。`--force` で取り直す |
| 2 | `discover-web.mjs` | 公式サイトのURLを探すとき（補助） | 何度でも |
| 3 | `fetch-web.mjs` | **最初に1回** | 既存ファイルはスキップ。`--force` で取り直す |
| 4 | `preprocess.mjs` | **ルールを変えるたび何度でも** | ✅ 何度でも。生データから作り直す |
| 5 | `verify-prompt.mjs` | **プロンプトを直したら毎回** | ✅ 読むだけ |
| 6 | `pilot.mjs` | 抽出を試すとき | ✅ 出力先は `data/pilot/` |
| 7 | `export-d1.mjs` | D1に入れる前 | ✅ `INSERT OR IGNORE` なので投入も安全 |

**4以降は何度でもやり直せます。**1と3だけが外部にアクセスするので、
むやみに再実行しないでください（国会会議録APIは短時間の大量アクセスが禁止されています）。

### 収集・前処理

```bash
node scripts/kokkai/collect.mjs                      # 国会会議録から収集
node scripts/kokkai/collect.mjs --only=P00007 --force # 特定の議員だけ取り直す
node scripts/kokkai/discover-web.mjs                 # 公式サイトの政策ページを探す（結果は目視で確定）
node scripts/kokkai/fetch-web.mjs                    # 公式サイトの本文を取得
node scripts/kokkai/preprocess.mjs                   # 3ソースを統合・正規化・フィルタ
```

`collect.mjs` と `fetch-web.mjs` は**生データを無加工で保存**します。
前処理のルールは必ず変わるので、raw さえ残っていれば API を叩き直さずにやり直せます。

### 抽出（LLM を使う）

```bash
node scripts/kokkai/verify-prompt.mjs                # プロンプトの自己矛盾を検査
node scripts/kokkai/pilot.mjs --n=50 --concurrency=4 # Anthropic API で抽出（要 ANTHROPIC_API_KEY）
```

抽出モデルの比較は `workers-ai-bench.mjs` で行います（要 `wrangler login`）。

```bash
node scripts/kokkai/workers-ai-bench.mjs --models=@cf/zai-org/glm-5.2 --all --verbose
```

### D1 への投入

```bash
node scripts/kokkai/export-d1.mjs                    # utterances.jsonl → SQL
npx wrangler d1 migrations apply civic-compass-db --local  --config api/wrangler.jsonc
npx wrangler d1 execute civic-compass-db --local  --config api/wrangler.jsonc --file=data/pilot/utterances.sql
```

本番へは `--local` を `--remote` に変えます。

---

## ライブラリ（直接実行しない）

`scripts/kokkai/` には、他のスクリプトから import される部品があります。

| ファイル | 役割 |
|---|---|
| `llm.mjs` | LLM 呼び出し。語彙定義（frame/target/stance/role）と Zod スキーマもここ |
| `align.mjs` | LLM が返した抜き出しを原文と照合して位置を特定する |
| `web-fetch-lib.mjs` | robots.txt の解釈とクロール間隔 |
| `pilot-report.mjs` | パイロット結果の Markdown 整形 |
| `politicians.json` | 対象議員マスタ。`speaker_id` は【1】【2】のキーなので**採番後は変更しない** |
| `prompts/*.md` | segment分割・フレーム抽出のプロンプト |

`llm.mjs` の `FRAMES` / `TARGETS` / `STANCES` / `ROLES` が語彙の正です。
`CLAUDE.personalize.md` §2 と一致していなければならず、**変更すると【1】の再抽出が必要**になります。

---

## API を使わずに抽出を試す

Anthropic API のクレジットがないときや、抽出の質を人が確かめたいときに使う一式です。

```bash
node scripts/kokkai/dump-samples.mjs        # 対象ブロックを読める形で書き出す
#   → 人（または Claude Code）が data/pilot/split.json に分割指定を書く
node scripts/kokkai/apply-split.mjs         # 分割を適用して segments.jsonl を作る
#   → 人が抽出して data/pilot/extracted.jsonl に書く
node scripts/kokkai/expand-evidence.mjs     # 短すぎる evidence_text を文単位まで広げる
node scripts/kokkai/build-utterances.mjs    # 原文と照合して utterances.jsonl とレポートを作る
```

**分割と抽出を1回でやらない**という設計上の約束（`CLAUDE.personalize.md` §6）を守るため、
手作業でも工程を分けています。

---

## 出力先

| ディレクトリ | 内容 | git |
|---|---|---|
| `data/raw/` | 国会会議録APIのレスポンス（無加工） | ignore |
| `data/raw_web/` | 公式サイトのページ本文 | ignore |
| `data/manual/` | **手で作ったテキスト。再生成できない** | ignore |
| `data/clean/` | 前処理済み。LLM 抽出の入力 | ignore |
| `data/pilot/` | パイロットの抽出結果とレポート | ignore |

`data/` は `.gitignore` 対象です。`data/manual/` **だけは再生成できない**ので、
失いたくない場合はバックアップを取ってください（公式サイトの文章は著作物なので、
リポジトリが公開なら `.gitignore` から外さないこと）。
