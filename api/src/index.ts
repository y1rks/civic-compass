/** Cloudflare Worker entry point for the civic-compass API. */
import { Hono } from "hono";

/** wrangler.jsonc に追加したバインディングは、ここに型を足すと `c.env` で型付きで参照できます。 */
export type Bindings = {
  // DB: D1Database;
};

/**
 * API 本体。ここに追加したルートは `/api/...` で公開されます。
 * 例: `api.get("/articles", ...)` -> `/api/articles`
 */
const api = new Hono<{ Bindings: Bindings }>();

api.get("/health", (c) => c.json({ status: "ok", service: "civic-compass-api" }));

const app = new Hono<{ Bindings: Bindings }>();

// ブラウザで http://localhost:8000/ を直接開いたときの動作確認用。
app.get("/", (c) =>
  c.json({
    service: "civic-compass-api",
    hint: "エンドポイントは /api 以下にあります。",
    endpoints: ["/api/health"],
  }),
);

app.route("/api", api);

export default app;
