/** Cloudflare Worker entry point for the civic-compass API. */
import { Hono } from "hono";
import { articles, createDb } from "@civic-compass/db";

/** wrangler.jsonc で設定したバインディング。 */
export type Bindings = {
  /** Cloudflare D1。frontend ワークスペースと同じデータベースを参照します。 */
  DB: D1Database;
};

/**
 * API 本体。ここに追加したルートは `/api/...` で公開されます。
 * 例: `api.get("/articles", ...)` -> `/api/articles`
 */
const api = new Hono<{ Bindings: Bindings }>();

api.get("/health", (c) => c.json({ status: "ok", service: "civic-compass-api" }));

// D1 への接続確認を兼ねた記事一覧。マイグレーション適用後に動きます。
api.get("/articles", async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db.select().from(articles).limit(20);

  return c.json({ articles: rows });
});

const app = new Hono<{ Bindings: Bindings }>();

// ブラウザで http://localhost:8000/ を直接開いたときの動作確認用。
// 実際のエンドポイントはすべて `/api` 以下にあります。
app.get("/", (c) =>
  c.json({
    service: "civic-compass-api",
    hint: "エンドポイントは /api 以下にあります。",
    endpoints: ["/api/health", "/api/articles"],
  }),
);

app.route("/api", api);

export default app;
