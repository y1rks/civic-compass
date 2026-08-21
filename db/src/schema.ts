// Cloudflare D1 (SQLite) のテーブル定義。
// このファイルを変更したら `npm run db:generate` でマイグレーションSQLを生成し、
// `npm run db:migrate` でD1へ適用します。
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

/** 政治ニュース記事 */
export const articles = sqliteTable("articles", {
  id: text("id").primaryKey(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  /** 段落の配列。SQLiteにJSON文字列として保存します。 */
  body: text("body", { mode: "json" }).$type<string[]>().notNull(),
  image: text("image").notNull(),
  source: text("source").notNull(),
  publishedAt: text("published_at").notNull(),
  readTime: text("read_time").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

/** 政治家 */
export const politicians = sqliteTable("politicians", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** 一覧のアイコンに表示する頭文字 */
  initials: text("initials").notNull(),
  party: text("party").notNull(),
  area: text("area").notNull(),
  /** 画面上の表示色 */
  color: text("color").notNull(),
  website: text("website").notNull(),
});

/** ユーザーが記事に対して保存した「関心あり」の記録 */
export const interests = sqliteTable(
  "interests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 認証導入までは端末ごとに発行した仮のIDを入れます。 */
    userId: text("user_id").notNull(),
    articleId: text("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    comment: text("comment").notNull().default(""),
    savedAt: text("saved_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("interests_user_id_idx").on(t.userId),
    // 同じ利用者が同じ記事を重複して保存しないようにします。
    unique("interests_user_article_unq").on(t.userId, t.articleId),
  ],
);

/** 保存した関心にもとづく政治家とのマッチ結果 */
export const matches = sqliteTable(
  "matches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    politicianId: text("politician_id")
      .notNull()
      .references(() => politicians.id, { onDelete: "cascade" }),
    /** 記事単位のマッチはarticleId有り、マイページの総合マッチはnullです。 */
    articleId: text("article_id").references(() => articles.id, {
      onDelete: "cascade",
    }),
    /** マッチ度(0-100) */
    score: real("score").notNull(),
    /** 考えが近いと判断した根拠 */
    reason: text("reason").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("matches_user_id_idx").on(t.userId)],
);

export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
export type Politician = typeof politicians.$inferSelect;
export type NewPolitician = typeof politicians.$inferInsert;
export type Interest = typeof interests.$inferSelect;
export type NewInterest = typeof interests.$inferInsert;
export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;
