# civic-compass

日々の政治ニュースへの関心を記録し、自分と考えが近い政治家を見つけるためのスマートフォン向けWebアプリです。

現在は画面のプロトタイプ段階です。ニュース、関心情報の保存、政治家のマッチングは、すべてフロントエンド内のスタブで動いています。

保存した関心情報とコメントはブラウザの `localStorage` に保存され、外部には公開されません。

## リポジトリ構成

npm workspaces によるモノレポ構成で、画面とAPIをまとめて管理します。

```text
civic-compass/
├── package.json           # ワークスペース定義と、まとめて起動するコマンド
├── package-lock.json      # 依存関係のロック（リポジトリ全体で1つ）
├── .gitignore             # 無視設定（リポジトリ全体で1つ）
├── eslint.config.mjs      # Lint設定（リポジトリ全体で1つ）
├── .vscode/               # 保存時Lintなどのエディタ設定
├── db/                    # DBスキーマ（frontend と api の共通ワークスペース）
│   ├── src/
│   │   ├── schema.ts      # テーブル定義
│   │   └── client.ts      # D1 から drizzle クライアントを作る
│   ├── migrations/        # 生成されたマイグレーションSQL（db:generate 実行時に作られます）
│   ├── drizzle.config.ts
│   └── package.json
├── frontend/              # 画面
│   ├── app/
│   │   ├── page.tsx       # 各画面と画面遷移
│   │   ├── globals.css    # スマートフォン向けスタイル
│   │   └── layout.tsx     # メタデータと共通レイアウト
│   ├── lib/
│   │   ├── api.ts         # APIスタブとサンプルデータ
│   │   └── types.ts       # 画面が使うデータ型
│   ├── tests/             # SSR結果のテスト
│   ├── worker/index.ts    # Cloudflare Worker のエントリポイント
│   ├── public/            # 静的ファイル
│   ├── vite.config.ts     # Vite 設定（APIへの proxy もここ）
│   └── package.json
└── api/                   # API
    ├── src/
    │   ├── index.ts       # ルーターの登録
    │   ├── bindings.ts    # D1 などバインディングの型
    │   └── routes/        # エンドポイント（ファイル名 = URL）
    │       ├── example.ts # -> /api/example（雛形）
    │       └── health.ts  # -> /api/health（D1疎通確認）
    ├── wrangler.jsonc     # Cloudflare Workers の設定
    └── package.json
```

DBスキーマを `db/` に切り出し、API Worker からD1を型安全に利用します。フロントエンドはD1へ直接接続せず、`/api/*`経由でAPI Workerを呼び出します。

## 主な機能

- 政治ニュースの一覧表示
- スクロールに応じた記事の追加読み込み
- ニュース詳細画面での記事閲覧
- コメントあり、またはコメントなしでの「関心あり」保存
- 関心を示した記事に基づく3人の政治家とのマッチング表示
- 政治家とのマッチ度と、考えが近い根拠の表示
- マイページでの総合マッチ結果表示
- 政治家個人ページへの外部リンク

## 動作環境

- Node.js 22.13.0以上
- npm

Node.jsのバージョンは次のコマンドで確認できます。

```bash
node --version
```

## セットアップ

**リポジトリ直下で**次のコマンドを実行します。`frontend` と `api` の依存関係がまとめて入ります。

```bash
npm install
```

> `frontend` や `api` の中で個別に `npm install` する必要はありません。依存関係はリポジトリ直下の `node_modules` にまとめられ、`package-lock.json` もリポジトリ直下の1つだけになります。

## ローカルでの起動方法

**リポジトリ直下で**次のコマンドを実行すると、フロントエンドとAPIが両方起動します。

```bash
npm run dev
```

| サービス | URL | 説明 |
| --- | --- | --- |
| フロントエンド | http://localhost:3000 | ブラウザで開く画面 |
| API | http://localhost:8000 | Cloudflare Workers (wrangler dev) |

ブラウザで http://localhost:3000 を開いてください。ログは `[frontend]` `[api]` の接頭辞で色分けして表示されます。

APIが起動しているかを確かめるには http://localhost:8000/api/health を開きます。`database`が`connected`なら、APIからD1まで正常に接続できています。雛形の http://localhost:8000/api/example も利用できます。

ポート3000が使用中の場合は、3001など別のポートで起動します。実際にターミナルへ表示されたURLを使用してください。

開発サーバーを終了するには `Ctrl + C` を押します。片方が異常終了した場合は、もう片方も自動的に停止します。

### 片方だけ起動したい場合

```bash
npm run dev:frontend   # 画面のみ
npm run dev:api        # APIのみ
```

## エディタ設定 (VSCode)

初回に、推奨拡張の [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) をインストールしてください。リポジトリを開くと右下に通知が出ます（拡張機能タブで「推奨」からも入れられます）。

インストールすると、[`.vscode/settings.json`](./.vscode/settings.json) の設定により**保存時に ESLint が自動で走り、修正できる指摘は自動修正**されます。自動修正できない指摘は波線で表示されます。

Lint の設定はリポジトリ直下の [`eslint.config.mjs`](./eslint.config.mjs) 1つで、frontend・api・db のすべてを対象にしています。意図的に使わない引数や変数は `_` で始めると警告になりません。

## 画面構成

### ニュース一覧

政治ニュースをカード形式で表示します。記事をタップすると詳細画面へ移動します。画面下部までスクロールすると、続きの記事が追加で表示されます。

### ニュース詳細

記事本文を表示します。画面下部の固定パネルから、任意のコメントとともに「関心あり」を保存できます。コメントを入力せずに保存することもできます。

### 政治家マッチ

関心を保存すると、考えが近い3人の政治家、マッチ度、似ている根拠をフルスクリーンのモーダルで表示します。

### マイページ

保存した関心情報をもとに、考えが近い政治家と総合マッチ度を表示します。

## 開発ガイド

### フロントエンドからAPIを呼ぶ

フロントエンドから `/api/...` を呼ぶと、Vite の proxy が自動的に API (8000番) へ転送します。同一オリジン扱いになるため、CORS の設定は不要です。

```ts
const res = await fetch("/api/example");
const data = await res.json();
```

ホスト名やポートをコードに書く必要はありません。proxy の設定は [`frontend/vite.config.ts`](./frontend/vite.config.ts) の `server.proxy` にあります。

### APIを実装する

API は Cloudflare Workers 上で動く [Hono](https://hono.dev/) で実装します。**エンドポイントごとに `src/routes/` へファイルを作り、ファイル名とURLを1対1で対応させます。**

```text
api/src/
├── index.ts               # ルーターの登録
├── bindings.ts            # D1 などバインディングの型
└── routes/
    ├── example.ts         ->  /api/example（雛形）
    ├── articles.ts        ->  /api/articles
    └── interests.ts       ->  /api/interests
```

#### 新しいエンドポイントを追加する手順

[`api/src/routes/example.ts`](./api/src/routes/example.ts) が雛形です。コピーして次の2手順で追加できます。

**1.** `src/routes/articles.ts` を作る（ファイル名がURLになります）

```ts
import { Hono } from "hono";
import type { AppEnv } from "../bindings";

const articles = new Hono<AppEnv>();

articles.get("/", (c) => c.json({ articles: [] }));               // GET /api/articles
articles.get("/:id", (c) => c.json({ id: c.req.param("id") }));   // GET /api/articles/:id

export default articles;
```

**2.** [`api/src/index.ts`](./api/src/index.ts) で登録する

```ts
import articles from "./routes/articles";

app.route("/api/articles", articles);
```

以上です。`/` が返すエンドポイント一覧は Hono の登録済みルートから自動生成しているので、手で追記する必要はありません。

ルーター内のパスはマウント先からの相対です。`app.route("/api/articles", articles)` の下で `articles.get("/")` と書くと `/api/articles` になります。

#### バインディングを追加する

[`api/wrangler.jsonc`](./api/wrangler.jsonc) に設定を書き、[`api/src/bindings.ts`](./api/src/bindings.ts) の `Bindings` 型に1行足すと、全ルーターで `c.env.DB` のように型付きで参照できます。

### 現在のAPIスタブ

画面が使うデータは、まだ [`frontend/lib/api.ts`](./frontend/lib/api.ts) 内のサンプルデータで動いています。

| 関数 | 用途 |
| --- | --- |
| `getArticles()` | ニュース一覧の取得 |
| `saveInterest()` | 関心情報とコメントの保存 |
| `getMatches()` | 記事単位の政治家マッチ取得 |
| `getProfileMatches()` | マイページの総合マッチ取得 |

`api/` 側の実装が進んだら、画面側の呼び出し方を変えずに、これらの関数の中身を `fetch("/api/...")` へ差し替える想定です。データ型は [`frontend/lib/types.ts`](./frontend/lib/types.ts) に定義しています。

## データベース (Cloudflare D1)

D1 は Workers から SQL で操作する SQLite ベースのデータベースです。テーブル定義は [`db/src/schema.ts`](./db/src/schema.ts) にまとめ、API Workerから利用します。ORMにはDrizzleを使います。

> **現在テーブルは未定義です。** 仕組み（ワークスペース、マイグレーション、バインディング）だけ用意してある状態なので、DBを使い始めるときに `db/src/schema.ts` へテーブルを追加してください。

### マイグレーション手順

スキーマを変更したら、**SQLの生成**と**DBへの適用**の2段階で反映します。どちらもリポジトリ直下で実行します。

```bash
# 1. db/src/schema.ts を編集する

# 2. 変更内容からマイグレーションSQLを生成する
npm run db:generate

# 3. ローカルのD1へ適用する
npm run db:migrate
```

`npm run db:generate` は `db/migrations/` に `0000_xxx.sql` のような連番のSQLを生成します（ディレクトリは初回実行時に作られます）。**生成されたSQLはコミットしてください。** チームの他のメンバーは `npm run db:migrate` を実行するだけで同じ状態になります。

本番（Cloudflare 上のD1）へ適用する場合は次を実行します。

```bash
npm run db:migrate:remote
```

### ローカルDBの中身を見る

```bash
# テーブル一覧
npm exec -w api -- wrangler d1 execute DB --local --persist-to ../.wrangler/state \
  --command "SELECT name FROM sqlite_master WHERE type='table';"
```

`--command` の中身を差し替えれば任意のSQLを実行できます。

### api から使う

テーブルを定義したあと、ルーターの中で `c.env.DB` を `createDb()` に渡します。

```ts
// api/src/routes/articles.ts
import { Hono } from "hono";
import { articles as articlesTable, createDb } from "@civic-compass/db";
import type { AppEnv } from "../bindings";

const articles = new Hono<AppEnv>();

articles.get("/", async (c) => {
  const db = createDb(c.env.DB);
  return c.json({ articles: await db.select().from(articlesTable).limit(20) });
});

export default articles;
```

### frontend から使う

フロントエンドからは`fetch("/api/...")`でAPI Workerを呼び出します。ローカルではVite proxy、本番ではCloudflare Service Bindingが同じパスを転送するため、CORS設定や環境別API URLは不要です。D1バインディングはAPI Workerだけが持ちます。

### Cloudflare 上のD1

本番用の`civic-compass-db`は作成済みで、[`api/wrangler.jsonc`](./api/wrangler.jsonc)にIDを設定しています。配置先はCloudflareの自動選択に任せ、現在はAPACリージョンに配置されています。

別のCloudflareアカウントへ複製する場合だけ、次のコマンドで新しいD1を作成してください。

```bash
npm exec -w api -- wrangler d1 create civic-compass-db
```

出力された`database_id`を[`api/wrangler.jsonc`](./api/wrangler.jsonc)の`d1_databases[0].database_id`へ反映します。D1のIDは秘密情報ではありません。

## よく使うコマンド

すべてリポジトリ直下で実行します。

| コマンド | 説明 |
| --- | --- |
| `npm run dev` | フロントエンドとAPIを同時に起動 |
| `npm run build` | 両方の本番ビルドを確認 |
| `npm run lint` | リポジトリ全体の ESLint |
| `npm run lint:fix` | ESLint の自動修正を適用 |
| `npm run test` | フロントエンドのSSR結果のテスト |
| `npm run typecheck` | frontend、api、dbの型とWrangler生成型をチェック |
| `npm run cf:typegen` | Wrangler設定からBinding型を再生成 |
| `npm run db:generate` | スキーマ変更からマイグレーションSQLを生成 |
| `npm run db:migrate` | ローカルD1へマイグレーションを適用 |
| `npm run db:migrate:remote` | Cloudflare上のD1へマイグレーションを適用 |

特定のワークスペースでコマンドを実行したい場合は `-w` を使います。

```bash
npm run <script> -w frontend
npm run <script> -w api
npm install <package> -w api    # api にだけ依存を追加する
```

## 使用技術

| 領域 | 技術 |
| --- | --- |
| 画面 | React 19 / vinext (Next.js互換) / TypeScript / Tailwind CSS / Lucide React |
| API | Cloudflare Workers / Hono / TypeScript |
| DB | Cloudflare D1 (SQLite) / Drizzle ORM / drizzle-kit |
| ビルド・実行 | npm workspaces / Vite / wrangler |

## デプロイ

`main`ブランチへのpushで[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)が起動し、検証、D1マイグレーション、API Worker、Frontend Workerの順でデプロイします。

初回デプロイ前にGitHubリポジトリの`Settings > Secrets and variables > Actions`へ次を登録してください。

| 種別 | 名前 | 内容 |
| --- | --- | --- |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | デプロイ先CloudflareアカウントID |
| Secret | `CLOUDFLARE_API_TOKEN` | 対象アカウントに限定したWorkers編集用APIトークン |
| Variable | `CLOUDFLARE_WORKERS_SUBDOMAIN` | アカウント共通の`workers.dev`サブドメイン（現在は`atno`） |
| Variable（任意） | `CIVIC_COMPASS_PUBLIC_URL` | 発行後の`https://civic-compass.<subdomain>.workers.dev`。設定時のみスモークテストを実行 |

API Workerは`workers.dev`へ公開せず、Frontend Workerの`API` Service Bindingからのみ呼び出します。Frontend Workerは`https://civic-compass.<subdomain>.workers.dev`で公開され、`/api/*`をAPI Workerへ転送します。

手動で同じ順序を実行する場合は次のコマンドを使います。

```bash
node scripts/migrate-d1-remote.mjs
npm run deploy:api
npm run deploy:frontend
```

## ポートについて

API のポートは wrangler のデフォルト (8787) ではなく **8000** を使用しています。変更する場合は次の2箇所を揃えてください。

1. [`api/wrangler.jsonc`](./api/wrangler.jsonc) の `dev.port`
2. [`frontend/vite.config.ts`](./frontend/vite.config.ts) の `server.proxy` の `target`

## 現在の制約

- ニュース記事と政治家はデモ用のサンプルデータです。
- 政治家名、政党、選挙区、マッチ度、マッチ理由はすべて架空です。
- 政治家個人ページのリンク先はデモ用URLです。
- 関心情報はDBではなく、利用中のブラウザにのみ保存されます。
- ブラウザのデータを削除すると、保存した関心情報も削除されます。
- ユーザー認証、複数端末間の同期、実際のLLM分析は未実装です。

## 今後のAPI連携時に必要な対応

1. ニュース一覧APIを `api/` に実装し、`getArticles()` から呼ぶ
2. 関心情報保存APIを `api/` に実装し、`saveInterest()` から呼ぶ
3. LLMを利用する政治家マッチAPIを `api/` に実装し、`getMatches()` から呼ぶ
4. ユーザー単位の総合マッチAPIを `api/` に実装し、`getProfileMatches()` から呼ぶ
5. 認証を導入し、`localStorage` の関心情報を D1 へ移す
6. 実在する政治家情報と公式WebサイトURLをAPIから取得する

DBを使う段階になったら、まず[`db/src/schema.ts`](./db/src/schema.ts)にテーブルを定義し、APIから参照してください。

政治的な判断に関わる情報を扱うため、本番運用時にはマッチングロジックの説明可能性、データの更新日、情報源、プライバシーポリシーも明示してください。
