/**
 * wrangler.jsonc で設定したバインディングの型。
 * バインディングを追加したら、ここに1行足せば全ルーターで型が効きます。
 */
export type Bindings = {
  /** Cloudflare D1。frontend ワークスペースと同じデータベースを参照します。 */
  DB: D1Database;
};

/**
 * 各ルーターはこの型で Hono を生成します。
 *
 * ```ts
 * const articles = new Hono<AppEnv>();
 * ```
 */
export type AppEnv = {
  Bindings: Bindings;
};
