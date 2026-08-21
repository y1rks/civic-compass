# PoliScope (civic-compass)

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
├── db/                    # DBスキーマ（frontend と api の共通ワークスペース）
│   ├── src/
│   │   ├── schema.ts      # テーブル定義
│   │   └── client.ts      # D1 から drizzle クライアントを作る
│   ├── migrations/        # 生成されたマイグレーションSQL
│   ├── drizzle.config.ts
│   └── package.json
├── frontend/              # 画面
│   ├── app/
│   │   ├── page.tsx       # 各画面と画面遷移
│   │   ├── globals.css    # スマートフォン向けスタイル
│   │   └── layout.tsx     # メタデータと共通レイアウト
│   ├── lib/
│   │   ├── api.ts         # APIスタブとサンプルデータ
│   │   ├── db.ts          # Server Component から D1 を使う入口
│   │   └── types.ts       # 画面が使うデータ型
│   ├── tests/             # SSR結果のテスト
│   ├── worker/index.ts    # Cloudflare Worker のエントリポイント
│   ├── public/            # 静的ファイル
│   ├── vite.config.ts     # Vite 設定（APIへの proxy もここ）
│   └── package.json
└── api/                   # API
    ├── src/index.ts       # Hono のルーティング
    ├── wrangler.jsonc     # Cloudflare Workers の設定
    └── package.json
```

DBスキーマを `db/` に切り出しているのは、frontend と api の両方が同じテーブル定義と型を参照するためです。

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

APIが起動しているかを確かめるには http://localhost:8000/api/health を開きます。`{"status":"ok"}` が返れば正常です。なお実際のエンドポイントはすべて `/api` 以下にあるため、http://localhost:8000/ は動作確認用の案内を返すだけです。

ポート3000が使用中の場合は、3001など別のポートで起動します。実際にターミナルへ表示されたURLを使用してください。

開発サーバーを終了するには `Ctrl + C` を押します。片方が異常終了した場合は、もう片方も自動的に停止します。

### 片方だけ起動したい場合

```bash
npm run dev:frontend   # 画面のみ
npm run dev:api        # APIのみ
```

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
const res = await fetch("/api/health");
const data = await res.json();
```

ホスト名やポートをコードに書く必要はありません。proxy の設定は [`frontend/vite.config.ts`](./frontend/vite.config.ts) の `server.proxy` にあります。

### APIを実装する

API は Cloudflare Workers 上で動く [Hono](https://hono.dev/) で実装します。エントリポイントは [`api/src/index.ts`](./api/src/index.ts) です。ルートは `api` に追加します。

```ts
api.get("/articles", (c) => c.json({ articles: [] }));
```

`app.route("/api", api)` でマウントしているため、上の例は `/api/articles` として公開されます。

D1 などのバインディングを追加する場合は [`api/wrangler.jsonc`](./api/wrangler.jsonc) に設定を書き、`api/src/index.ts` の `Bindings` 型に追記すると `c.env.DB` として型付きで参照できます。

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

D1 は Workers から SQL で操作する SQLite ベースのデータベースです。テーブル定義は [`db/src/schema.ts`](./db/src/schema.ts) の1か所にまとめ、frontend と api の両方が同じ定義を参照します。ORM には Drizzle を使います。

### マイグレーション手順

スキーマを変更したら、**SQLの生成**と**DBへの適用**の2段階で反映します。どちらもリポジトリ直下で実行します。

```bash
# 1. db/src/schema.ts を編集する

# 2. 変更内容からマイグレーションSQLを生成する
npm run db:generate

# 3. ローカルのD1へ適用する
npm run db:migrate
```

`npm run db:generate` は [`db/migrations/`](./db/migrations/) に `0001_xxx.sql` のような連番のSQLを生成します。**生成されたSQLはコミットしてください。** チームの他のメンバーは `npm run db:migrate` を実行するだけで同じ状態になります。

本番（Cloudflare 上のD1）へ適用する場合は次を実行します。

```bash
npm run db:migrate:remote
```

### ローカルDBの中身を見る

```bash
npm exec -w api -- wrangler d1 execute DB --local --persist-to ../.wrangler/state \
  --command "SELECT * FROM articles LIMIT 10;"
```

### api から使う

`c.env.DB` を `createDb()` に渡します。

```ts
import { articles, createDb } from "@civic-compass/db";

api.get("/articles", async (c) => {
  const db = createDb(c.env.DB);
  return c.json({ articles: await db.select().from(articles).limit(20) });
});
```

### frontend から使う

Server Component / Server Action から [`frontend/lib/db.ts`](./frontend/lib/db.ts) の `getDb()` を呼びます。

```tsx
import { articles, getDb } from "../lib/db";

export default async function Page() {
  const rows = await getDb().select().from(articles).limit(5);
  return <ArticleList articles={rows} />;
}
```

クライアントコンポーネント（`"use client"`）からは呼べません。ブラウザ側で必要なデータは、api 経由（`fetch("/api/...")`）で取得するか、Server Component で取得して props で渡してください。

### ローカルDBの共有について

frontend と api は別プロセスで起動しますが、次の設定で**同じローカルD1**を読み書きします。

| ワークスペース | 設定箇所 | 内容 |
| --- | --- | --- |
| frontend | [`vite.config.ts`](./frontend/vite.config.ts) | `persistState: { path: "../.wrangler/state" }` |
| api | [`package.json`](./api/package.json) | `wrangler dev --persist-to ../.wrangler/state` |

実体はリポジトリ直下の `.wrangler/state/v3/d1/` に作られます（gitignore 済み）。バインディング名 `DB` と `database_name` も両者で揃えてあります。片方だけ変更すると別々のDBを見てしまうので注意してください。

### Cloudflare 上にD1を作る

現在 `database_id` はプレースホルダーです。実際にCloudflareへデプロイする際は、次の手順で作成してIDを設定してください。

```bash
npm exec -w api -- wrangler d1 create civic-compass-db
```

出力された `database_id` を2か所に反映します。

1. [`api/wrangler.jsonc`](./api/wrangler.jsonc) の `d1_databases[0].database_id`
2. [`frontend/vite.config.ts`](./frontend/vite.config.ts) の `localBindingConfig.d1_databases[0].database_id`

## よく使うコマンド

すべてリポジトリ直下で実行します。

| コマンド | 説明 |
| --- | --- |
| `npm run dev` | フロントエンドとAPIを同時に起動 |
| `npm run build` | 両方の本番ビルドを確認 |
| `npm run lint` | フロントエンドの ESLint |
| `npm run test` | フロントエンドのSSR結果のテスト |
| `npm run typecheck` | db と api の型チェック |
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

このリポジトリを操作しても自動的に外部へデプロイされることはありません。API を Cloudflare へ公開する場合は `npm run deploy -w api` を実行します。

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
5. 認証を導入し、`localStorage` の関心情報を D1 の `interests` テーブルへ移す
6. 実在する政治家情報と公式WebサイトURLをAPIから取得する

テーブル定義（`articles` / `politicians` / `interests` / `matches`）は [`db/src/schema.ts`](./db/src/schema.ts) に用意済みです。データ投入や参照の実装から進められます。

政治的な判断に関わる情報を扱うため、本番運用時にはマッチングロジックの説明可能性、データの更新日、情報源、プライバシーポリシーも明示してください。
