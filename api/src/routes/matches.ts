import { Hono } from "hono";
import type { AppEnv } from "../bindings";
import { createProfileMatches } from "../data/politicians";

/**
 * 政治コンパス画面の総合マッチ。**まだデモ用の固定値です**
 * （C の実装は docs/implementing-match-api.md）。
 *
 * 記事1件ぶんの結果は B が担当します（`GET /api/perspectives/:articleId`）。
 * こちらはマッチ度ではなく「その論点を議員がどう語ってきたか」を返します。
 */
const matches = new Hono<AppEnv>();

matches.post("/profile", async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return c.json({ status: "error", message: "JSON body is required" }, 400);
  }

  const { articleIds } = body as Record<string, unknown>;
  if (!Array.isArray(articleIds) || !articleIds.every((id) => typeof id === "string")) {
    return c.json({ status: "error", message: "articleIds must be an array of strings" }, 400);
  }

  return c.json({ matches: createProfileMatches(articleIds) });
});

export default matches;
