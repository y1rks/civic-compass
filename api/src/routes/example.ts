// GET /api/example — 新しいエンドポイントを作るときの雛形です。
//
// ★ このファイルをコピーして、次の3点を変えてください。
//    1. ファイル名               例: articles.ts
//    2. 変数名 (2か所)           例: const articles = ...  /  export default articles
//    3. src/index.ts でのマウント 例: app.route("/api/articles", articles)
//
//    `/` が返すエンドポイント一覧は自動生成されるので、追記は不要です。
import { Hono } from "hono";
import type { AppEnv } from "../bindings";

const example = new Hono<AppEnv>();

// このルーターは src/index.ts で `/api/example` にマウントされるため、
// ここでの "/" が `/api/example` になります。
example.get("/", (c) => c.json({ status: "ok", service: "civic-compass-api" }));

// ルートを増やす場合の書き方:
//
//   example.get("/:id", (c) => c.json({ id: c.req.param("id") }));  // GET  /api/example/:id
//   example.post("/", async (c) => c.json(await c.req.json()));     // POST /api/example
//
// D1 を使う場合 (db/src/schema.ts にテーブルを定義してから):
//
//   import { articles, createDb } from "@civic-compass/db";
//
//   example.get("/", async (c) => {
//     const db = createDb(c.env.DB);
//     return c.json(await db.select().from(articles).limit(20));
//   });

export default example;
