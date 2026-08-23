/**
 * Wrangler が生成した Env から、API が使うバインディングを取り出します。
 *
 * `PROFILES` … 議員・政党プロファイルとセル逆引き（バッチが投入する読み取り専用）
 * `USER_PROFILES` … ユーザープロファイル（意見の保存時に書き込む）
 */
export type Bindings = Pick<Env, "DB" | "PROFILES" | "USER_PROFILES">;

/** Cookieから解決した、現在のリクエストのユーザー。 */
export type CurrentUser = {
  userId: string;
  name: string;
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
  Variables: {
    currentUser: CurrentUser;
  };
};
