/** Cloudflare Worker entry point for the civic-compass API. */
import { Hono } from "hono";
import type { AppEnv } from "./bindings";
import answers from "./routes/answers";
import articles from "./routes/articles";
import example from "./routes/example";
import health from "./routes/health";
import matches from "./routes/matches";
import perspectives from "./routes/perspectives";
import userProfile from "./routes/user-profile";

const app = new Hono<AppEnv>();

// ブラウザで http://localhost:8000/ を直接開いたときの動作確認用。
// 一覧は登録済みルートから自動生成するため、APIを追加してもこの関数は変更不要です。
app.get("/", (c) =>
  c.json({
    service: "civic-compass-api",
    hint: "エンドポイントは /api 以下にあります。",
    endpoints: [
      ...new Set(
        app.routes
          .filter((route) => route.path.startsWith("/api"))
          .map((route) => `${route.method} ${route.path}`),
      ),
    ].sort(),
  }),
);

// ★ ルーターの登録。ファイルのパスとURLが1対1で対応します。
//    新しいAPIを追加するときは、ここに1行足すだけです。
//
//    src/routes/example.ts    ->  /api/example
//    src/routes/articles.ts   ->  /api/articles
//    src/routes/answers.ts    ->  /api/answers
app.route("/api/answers", answers);
app.route("/api/articles", articles);
app.route("/api/example", example);
app.route("/api/health", health);
app.route("/api/matches", matches);
app.route("/api/perspectives", perspectives);
app.route("/api/user-profile", userProfile);

app.onError((error, c) => {
  console.error(JSON.stringify({
    message: "Unhandled API error",
    error: error.message,
    method: c.req.method,
    path: c.req.path,
  }));

  return c.json({ status: "error", message: "Internal server error" }, 500);
});

export default app;
