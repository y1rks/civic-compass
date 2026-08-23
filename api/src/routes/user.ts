import { Hono } from "hono";
import type { AppEnv } from "../bindings";
import { requireCurrentUser } from "../session";

const user = new Hono<AppEnv>();

user.use("*", requireCurrentUser);

/** Cookieから解決した現在のユーザー情報を返します。 */
user.get("/", (c) => {
  const currentUser = c.get("currentUser");
  c.header("Cache-Control", "no-store");
  return c.json({ user: { user_id: currentUser.userId, name: currentUser.name } });
});

export default user;
