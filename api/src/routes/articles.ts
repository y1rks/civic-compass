import { Hono } from "hono";
import { asc } from "drizzle-orm";
import { articles as articlesTable, createDb } from "@civic-compass/db";
import type { AppEnv } from "../bindings";

const articles = new Hono<AppEnv>();

articles.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const articleRows = await db.select().from(articlesTable).orderBy(asc(articlesTable.displayOrder));

  return c.json({
    articles: articleRows.map(({ displayOrder: _, body, ...article }) => ({
      ...article,
      body: JSON.parse(body) as string[],
    })),
  });
});

export default articles;
