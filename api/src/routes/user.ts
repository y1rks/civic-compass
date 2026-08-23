import { Hono } from "hono";
import type { AppEnv } from "../bindings";
import { CURRENT_USER_ID } from "../current-user";

const user = new Hono<AppEnv>();

type UserRow = {
  user_id: string;
  name: string;
};

/** 現在のユーザーの表示用情報をD1から取得します。 */
user.get("/", async (c) => {
  const currentUser = await c.env.DB
    .prepare("SELECT user_id, name FROM users WHERE user_id = ?1 LIMIT 1")
    .bind(CURRENT_USER_ID)
    .first<UserRow>();

  if (currentUser === null) {
    return c.json({ status: "error", message: "User not found" }, 404);
  }

  return c.json({ user: currentUser });
});

export default user;
