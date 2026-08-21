// Cloudflare D1 用の drizzle クライアント。
// D1 は Workers 上から SQL で操作する SQLite ベースのデータベースなので、
// drizzle も D1 専用ドライバ (drizzle-orm/d1) を使います。
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/**
 * D1 バインディングから drizzle クライアントを作ります。
 *
 * バインディングは Workers の実行環境からしか取得できないため、
 * リクエストを受けたタイミングで呼び出してください。
 *
 * ```ts
 * // api (Hono) の場合
 * api.get("/articles", async (c) => {
 *   const db = createDb(c.env.DB);
 *   return c.json(await db.select().from(articles));
 * });
 * ```
 */
export function createDb(binding: D1Database) {
  return drizzle(binding, { schema });
}

export type Db = ReturnType<typeof createDb>;
