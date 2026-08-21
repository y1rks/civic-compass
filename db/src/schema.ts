// Cloudflare D1 (SQLite) のテーブル定義。
//
// まだテーブルはありません。DBを使い始めるときに、ここへ Drizzle のテーブルを追加してください。
//
//   import { sql } from "drizzle-orm";
//   import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
//
//   export const articles = sqliteTable("articles", {
//     id: text("id").primaryKey(),
//     title: text("title").notNull(),
//     createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
//   });
//
//   export type Article = typeof articles.$inferSelect;
//   export type NewArticle = typeof articles.$inferInsert;
//
// 追加したら `npm run db:generate` でマイグレーションSQLを生成し、
// `npm run db:migrate` でD1へ適用します。
export {};
