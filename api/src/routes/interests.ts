import { Hono } from "hono";
import type { AppEnv } from "../bindings";

const interests = new Hono<AppEnv>();

interests.post("/", async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return c.json({ status: "error", message: "JSON body is required" }, 400);
  }

  const { articleId, comment } = body as Record<string, unknown>;
  if (typeof articleId !== "string" || articleId.length === 0 || typeof comment !== "string" || comment.length > 160) {
    return c.json({ status: "error", message: "articleId and a comment of up to 160 characters are required" }, 400);
  }

  return c.json({
    interest: {
      articleId,
      comment,
      interested: true as const,
      savedAt: new Date().toISOString(),
    },
  });
});

export default interests;
