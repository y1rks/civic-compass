import { Hono } from "hono";
import type { AppEnv } from "../bindings";
import { createProfileMatches, politicianMatches } from "../data/politicians";

const matches = new Hono<AppEnv>();

matches.get("/:articleId", (c) => {
  const articleId = c.req.param("articleId");
  if (articleId.length === 0) {
    return c.json({ status: "error", message: "articleId is required" }, 400);
  }

  return c.json({ matches: politicianMatches });
});

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
