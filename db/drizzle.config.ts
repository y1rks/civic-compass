import { defineConfig } from "drizzle-kit";

// D1 は SQLite ベースのため dialect は "sqlite" です。
// 生成したSQLの適用は drizzle-kit ではなく `wrangler d1 migrations apply` が行うので、
// ここでは接続情報を持たせず、SQLの生成先だけを指定します。
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
});
