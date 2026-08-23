import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv, CurrentUser } from "./bindings";

const SESSION_COOKIE_NAME = "civic_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

type CurrentUserRow = {
  user_id: string;
  name: string;
};

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Cookieへ入れる、推測困難な256ビットのセッショントークンを生成します。 */
function createSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** D1へ生のトークンを残さないよう、検索キーへ変換します。 */
async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

/** 有効なCookieに対応するユーザーをD1から解決します。 */
export async function resolveCurrentUser(c: Context<AppEnv>): Promise<CurrentUser | null> {
  const token = getCookie(c, SESSION_COOKIE_NAME, "host");
  if (token === undefined || !/^[0-9a-f]{64}$/.test(token)) return null;

  const tokenHash = await hashSessionToken(token);
  const now = new Date().toISOString();
  const row = await c.env.DB.prepare(`
    SELECT u.user_id, u.name
    FROM user_sessions AS s
    INNER JOIN users AS u ON u.user_id = s.user_id
    WHERE s.token_hash = ?1 AND s.expires_at > ?2
    LIMIT 1
  `).bind(tokenHash, now).first<CurrentUserRow>();

  return row === null ? null : { userId: row.user_id, name: row.name };
}

/** 名前入力後にユーザーとセッションを同じD1バッチで作成します。 */
export async function createUserSession(c: Context<AppEnv>, name: string): Promise<CurrentUser> {
  const userId = `usr_${crypto.randomUUID()}`;
  const internalEmail = `${userId}@anonymous.invalid`;
  const token = createSessionToken();
  const tokenHash = await hashSessionToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  const timestamp = now.toISOString();

  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO users (user_id, name, email, last_login_at, created_at)
      VALUES (?1, ?2, ?3, NULL, ?4)
    `).bind(userId, name, internalEmail, timestamp),
    c.env.DB.prepare(`
      INSERT INTO user_sessions (token_hash, user_id, created_at, last_seen_at, expires_at)
      VALUES (?1, ?2, ?3, ?3, ?4)
    `).bind(tokenHash, userId, timestamp, expiresAt.toISOString()),
  ]);

  setCookie(c, SESSION_COOKIE_NAME, token, {
    prefix: "host",
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    priority: "High",
  });

  return { userId, name };
}

/** ユーザー依存APIでCookieを検証し、解決したユーザーをリクエスト内へ渡します。 */
export const requireCurrentUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const currentUser = await resolveCurrentUser(c);
  if (currentUser === null) {
    return c.json({ status: "error", message: "Session required" }, 401);
  }

  c.set("currentUser", currentUser);
  await next();
};
