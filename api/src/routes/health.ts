import { Hono } from "hono";
import type { AppEnv } from "../bindings";

const health = new Hono<AppEnv>();

health.get("/", async (c) => {
  const result = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();

  if (result?.ok !== 1) {
    return c.json({ status: "error", service: "civic-compass-api", database: "unavailable" }, 503);
  }

  return c.json({ status: "ok", service: "civic-compass-api", database: "connected" });
});

export default health;
