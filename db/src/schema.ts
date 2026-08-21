import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** 記事一覧と詳細画面で表示する記事です。本文は段落配列をJSON文字列で保存します。 */
export const articles = sqliteTable("articles", {
  id: text("id").primaryKey(),
  displayOrder: integer("display_order").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  body: text("body").notNull(),
  image: text("image").notNull(),
  source: text("source").notNull(),
  publishedAt: text("published_at").notNull(),
});

export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
