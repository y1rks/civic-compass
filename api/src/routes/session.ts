import { Hono } from "hono";
import type { AppEnv } from "../bindings";
import { createUserSession, resolveCurrentUser } from "../session";

const session = new Hono<AppEnv>();

const NAME_MAX_LENGTH = 30;

const responseUser = (user: { userId: string; name: string }) => ({
  user_id: user.userId,
  name: user.name,
});

/** Cookieのセッション状態を確認します。未登録の場合は user: null を返します。 */
session.get("/", async (c) => {
  const currentUser = await resolveCurrentUser(c);
  c.header("Cache-Control", "no-store");
  return c.json({ user: currentUser === null ? null : responseUser(currentUser) });
});

/** 初回入力の名前で匿名ユーザーを作り、ブラウザへセッションCookieを発行します。 */
session.post("/", async (c) => {
  const currentUser = await resolveCurrentUser(c);
  if (currentUser !== null) {
    c.header("Cache-Control", "no-store");
    return c.json({ user: responseUser(currentUser) });
  }

  const body: unknown = await c.req.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return c.json({ status: "error", message: "JSON body is required" }, 400);
  }

  const rawName = (body as Record<string, unknown>).name;
  if (typeof rawName !== "string") {
    return c.json({ status: "error", message: "name is required" }, 400);
  }

  const name = rawName.trim();
  const nameLength = Array.from(name).length;
  if (nameLength === 0 || nameLength > NAME_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) {
    return c.json({ status: "error", message: `name must be between 1 and ${NAME_MAX_LENGTH} characters` }, 400);
  }

  const createdUser = await createUserSession(c, name);
  c.header("Cache-Control", "no-store");
  return c.json({ user: responseUser(createdUser) }, 201);
});

export default session;
