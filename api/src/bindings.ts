/** Wrangler が生成した Env から、API が使うバインディングを取り出します。 */
export type Bindings = Pick<Env, "DB">;

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
