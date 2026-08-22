import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { CELL_ROLES, FRAMES, ROLES, STANCES, TARGETS, inList } from "@civic-compass/shared";

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

// ---------------------------------------------------------------------------
// 【1】utterances —— LLM が segment ごとに出力した生の抽出結果。
//
// 追記のみ・書き換え禁止。これを消すと LLM の再実行が必要になります。
// 【2】議員プロファイル（KV）はここから何度でも作り直せる派生データです。
//
// justification_frames を JSON で持たず正規化しているのは、集計が
// `frame × target × role` の GROUP BY になるためです。
// ---------------------------------------------------------------------------

/** 発言を話題のまとまりで分割した1セグメント。抽出の単位です。 */
export const utterances = sqliteTable(
  "utterances",
  {
    utteranceId: text("utterance_id").primaryKey(),
    speakerId: text("speaker_id").notNull(),
    politicianName: text("politician_name").notNull(),
    /** kokkai | web | manual */
    sourceKind: text("source_kind").notNull(),

    // --- 出所 ---
    meetingId: text("meeting_id"),
    speechId: text("speech_id"),
    /** 議事録上の発言ブロック番号（不変） */
    speechIndex: integer("speech_index"),
    /** 分割で振った番号 */
    segmentIndex: integer("segment_index").notNull(),
    /** 元ブロック内の絶対位置。分割をやり直してもずれないよう block 基準で持ちます。 */
    charRangeStart: integer("char_range_start").notNull(),
    charRangeEnd: integer("char_range_end").notNull(),
    url: text("url"),

    // --- 発言時点の属性。API の値をそのまま入れ、LLM には推測させません ---
    date: text("date"),
    /** 国会質疑 | 政府答弁 | 本会議 | 選挙公約 など */
    speechType: text("speech_type").notNull(),
    /** spontaneous | party_leader_debate | budget_committee_answer | ministry_committee_answer */
    answerContext: text("answer_context").notNull(),
    /** 答弁の「本人度」による重み。集計時に掛けます。 */
    weight: real("weight").notNull(),
    positionAtTime: text("position_at_time"),
    /** ★発言時点の党籍。現所属ではありません。 */
    partyAtTime: text("party_at_time"),

    // --- 再現性のためのバージョン ---
    extractVersion: text("extract_version").notNull(),
    segmentationVersion: text("segmentation_version").notNull(),

    // --- 抽出結果 ---
    /** 価値含意なし。true でもレコードは残します（share の分母・取りこぼし監査に必要） */
    noValueContent: integer("no_value_content", { mode: "boolean" }).notNull(),
    summary: text("summary"),
    confidence: real("confidence"),

    // --- 原文（LLM に出力させず、パイプラインがコピーします） ---
    /** このセグメントの全文 */
    quote: text("quote").notNull(),
    /** 分割前のブロック全文。分割していない場合は quote と同じなので null。 */
    blockText: text("block_text"),
    /** 国会会議録は公文書なので原文引用可。公式サイトは著作物なので要約＋リンクで扱います。 */
    quotable: integer("quotable", { mode: "boolean" }).notNull(),

    /** 原文に引用が見つからず採用しなかったフレーム（監査用・JSON文字列） */
    rejectedFrames: text("rejected_frames"),

    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("utterances_speaker_idx").on(t.speakerId),
    index("utterances_date_idx").on(t.date),
  ],
);

/** 1セグメントから抽出した正当化フレーム。1行1フレームです。 */
export const utteranceFrames = sqliteTable(
  "utterance_frames",
  {
    frameId: text("frame_id").primaryKey(),
    utteranceId: text("utterance_id")
      .notNull()
      .references(() => utterances.utteranceId),
    /** 集計を1テーブルで済ませるための非正規化 */
    speakerId: text("speaker_id").notNull(),

    /** care_harm | fairness | liberty_autonomy など10種 */
    frame: text("frame", { enum: FRAMES }).notNull(),
    /** uphold（根拠として持ち出した） | override（優先順位で下に置いた） | neutral */
    stance: text("stance", { enum: STANCES }).notNull(),
    /** その発言内での比重 0.0-1.0 */
    intensity: real("intensity").notNull(),

    /** そう判断した根拠。原文からの一字一句の引用です。 */
    evidenceText: text("evidence_text").notNull(),
    /** 元ブロック絶対位置。`block_text ?? quote` からそのまま切り出せます。 */
    evidenceSpanStart: integer("evidence_span_start"),
    evidenceSpanEnd: integer("evidence_span_end"),
    /** exact | normalized。not_found は採用しないのでここには入りません。 */
    evidenceMatch: text("evidence_match").notNull(),
  },
  (t) => [
    index("utterance_frames_utterance_idx").on(t.utteranceId),
    index("utterance_frames_speaker_idx").on(t.speakerId),
    index("utterance_frames_cell_idx").on(t.speakerId, t.frame),
  ],
);

/**
 * フレームが誰について語られたか。1フレームが複数の対象を持つことがあります。
 * （「外国資本を threat、国民全体を beneficiary」のように同時に語られる）
 *
 * `role` をセルキーから落とすと正反対の思想が同一視されるため、必ず保持します。
 */
export const utteranceFrameTargets = sqliteTable(
  "utterance_frame_targets",
  {
    frameId: text("frame_id")
      .notNull()
      .references(() => utteranceFrames.frameId),
    /** 個人 / 家族 / 子ども・将来世代 など14種 */
    entity: text("entity", { enum: TARGETS }).notNull(),
    /** beneficiary（守る対象） | threat（脅威として名指す） | neutral（言及のみ） */
    role: text("role", { enum: ROLES }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.frameId, t.entity, t.role] }),
    index("utterance_frame_targets_cell_idx").on(t.entity, t.role),
  ],
);

export type Utterance = typeof utterances.$inferSelect;
export type NewUtterance = typeof utterances.$inferInsert;
export type UtteranceFrame = typeof utteranceFrames.$inferSelect;
export type NewUtteranceFrame = typeof utteranceFrames.$inferInsert;
export type UtteranceFrameTarget = typeof utteranceFrameTargets.$inferSelect;
export type NewUtteranceFrameTarget = typeof utteranceFrameTargets.$inferInsert;

// ---------------------------------------------------------------------------
// 記事の争点と選択肢 —— ユーザー側プロファイル【3】の入力源。
//
// 1設問 ＝ `frame × target × role` のセル1つ。選択肢は uphold / override /
// neutral の3つで、単一選択です。
//
// ★ stance をUIコントロール（賛成／反対ボタン）にしてはいけません。
//   uphold / override は「その価値を根拠として持ち出したか、優先順位で下に
//   置いたか」という言語行為の分類で、一般の利用者は必ず「賛否」と解釈します。
//   stance は必ず label_text の文面に埋め込み、利用者には「どの言い分に近いか」
//   だけを選ばせます。
//
// ★ neutral は cells に入れません（回答レコードには残します）。
//   score 0 のセルとして集計すると、議員側の score が +0.9 台に張り付いている
//   ため agree が 0.55 で確定し、「全部どちらとも言えない」と答えた利用者が
//   最も高いマッチ度を得ます（実測で確認済み）。議員側の stance: neutral は
//   全体の 0.2% しかなく、片側だけ neutral が多いとスケールが合いません。
// ---------------------------------------------------------------------------

/** 記事1本の争点。frame × target × role を1つ固定して問います。 */
export const articleQuestions = sqliteTable(
  "article_questions",
  {
    id: text("id").primaryKey(),
    articleId: text("article_id")
      .notNull()
      .references(() => articles.id),
    displayOrder: integer("display_order").notNull(),
    /** 争点の見出し。例:「電気料金への影響について」 */
    prompt: text("prompt").notNull(),

    // --- セルキー。語彙は shared/src/vocabulary.ts が正（docs/data-reference.md 参照）---
    /** care_harm | fairness | liberty_autonomy など10種 */
    frame: text("frame", { enum: FRAMES }).notNull(),
    /** 個人 / 家族 / 子ども・将来世代 など14種 */
    target: text("target", { enum: TARGETS }).notNull(),
    /** beneficiary（守る対象） | threat（脅威として名指す）。neutral は使わない。 */
    role: text("role", { enum: CELL_ROLES }).notNull(),

    // --- 寄与 w = intensity × confidence × interest の固定分 ---
    /** 発言側の intensity にあたる固定値 */
    intensity: real("intensity").notNull().default(0.7),
    /** 議員側は LLM の抽出確信度。手書きの選択肢はスケールを合わせるための定数。 */
    confidence: real("confidence").notNull().default(0.9),
  },
  (t) => [
    index("article_questions_article_idx").on(t.articleId),
    // drizzle の enum は TypeScript の型だけで DB を縛らないため、CHECK も張る。
    // これらは新規テーブルなので、制約追加でテーブルを作り直す必要がない。
    check("article_questions_frame_check", sql.raw(inList("frame", FRAMES))),
    check("article_questions_target_check", sql.raw(inList("target", TARGETS))),
    check("article_questions_role_check", sql.raw(inList("role", CELL_ROLES))),
  ],
);

/**
 * 1設問の選択肢。uphold / override / neutral の3行で1組です。
 *
 * uphold と override を必ず対で提示することが要点で、これにより
 * 実データで出現率の低い override（議員側 7.3%）を構造的に取れます。
 */
export const articleQuestionOptions = sqliteTable(
  "article_question_options",
  {
    id: text("id").primaryKey(),
    questionId: text("question_id")
      .notNull()
      .references(() => articleQuestions.id),
    displayOrder: integer("display_order").notNull(),
    /** uphold（根拠として持ち出した） | override（優先順位で下に置いた） | neutral */
    stance: text("stance", { enum: STANCES }).notNull(),
    /** 画面に出す一文。stance の意味はこの文面が担います。 */
    labelText: text("label_text").notNull(),
  },
  (t) => [
    index("article_question_options_question_idx").on(t.questionId),
    check("article_question_options_stance_check", sql.raw(inList("stance", STANCES))),
  ],
);

export type ArticleQuestion = typeof articleQuestions.$inferSelect;
export type NewArticleQuestion = typeof articleQuestions.$inferInsert;
export type ArticleQuestionOption = typeof articleQuestionOptions.$inferSelect;
export type NewArticleQuestionOption = typeof articleQuestionOptions.$inferInsert;

// ---------------------------------------------------------------------------
// 【3a】ユーザーと回答 —— ユーザープロファイル【3】の元データ。
//
// 【1】utterances と同じ位置づけで、KV のユーザープロファイルは
// ここから何度でも作り直せる派生データです。集計式は必ず変わるので、
// 生の回答をここに残しておくことが要点になります。
//
// ---------------------------------------------------------------------------

/** 回答の出どころ。LLM 抽出に切り替えたとき、行を足すだけで済むように持ちます。 */
const ANSWER_SOURCES = ["question", "llm"] as const;

/**
 * 回答の持ち主。id / name / email が必須です。
 *
 * パスワードや認証情報は持ちません。プロトタイプでは本人確認をしないので、
 * `email` は連絡先兼一意キーであって、認証済みであることを意味しません。
 */
export const users = sqliteTable(
  "users",
  {
    userId: text("user_id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),

    /**
     * 最後にログインした時刻（ISO8601・UTC）。
     * ログインの仕組みがまだ無いので、当面は null のままです。
     */
    lastLoginAt: text("last_login_at"),

    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

/**
 * 1ユーザー × 1記事の回答。同じ記事に答え直すと上書きします
 * （【1】utterances と違い、こちらは書き換えを許す。UI が編集を前提にしているため）。
 */
export const answers = sqliteTable(
  "answers",
  {
    answerId: text("answer_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.userId),
    articleId: text("article_id")
      .notNull()
      .references(() => articles.id),

    /**
     * このニュースへの関心度（0 / 0.5 / 1）。
     * 寄与 w = intensity × confidence × interest の interest にあたり、
     * 議員側の weight（答弁の本人度）と同じ位置に入ります。
     * 0 なら寄与が 0 になるので cells には入りませんが、レコードは残します。
     */
    interest: real("interest").notNull(),

    /** 自由記述。いまは保存するだけで、LLM 抽出は未実装です。 */
    opinionText: text("opinion_text"),
    /** LLM 抽出を流したら記録します。未抽出なら null。 */
    extractVersion: text("extract_version"),

    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("answers_user_idx").on(t.userId),
    // 1ユーザー × 1記事で1行。答え直しは UPSERT になります。
    uniqueIndex("answers_user_article_idx").on(t.userId, t.articleId),
    check("answers_interest_check", sql`interest >= 0 AND interest <= 1`),
  ],
);

/**
 * 設問1問ぶんの回答。cells の集計はここを `frame × target × role` で
 * GROUP BY するだけになります。
 *
 * ★ frame / target / role / intensity を article_questions から複製しています。
 *   設問の文面やセルの割り当ては後から見直す前提のもので、参照のままだと
 *   過去の回答の意味が黙って変わります。発言側で `party_at_time`（発言時点の党籍）を
 *   持っているのと同じ理由で、回答時点の値を固定します。
 */
export const answerSelections = sqliteTable(
  "answer_selections",
  {
    answerId: text("answer_id")
      .notNull()
      .references(() => answers.answerId),
    questionId: text("question_id")
      .notNull()
      .references(() => articleQuestions.id),

    /** uphold（根拠として持ち出した） | override（優先順位で下に置いた） | neutral */
    stance: text("stance", { enum: STANCES }).notNull(),

    // --- 回答時点のセル。article_questions からの複製（上記★） ---
    frame: text("frame", { enum: FRAMES }).notNull(),
    target: text("target", { enum: TARGETS }).notNull(),
    role: text("role", { enum: CELL_ROLES }).notNull(),
    intensity: real("intensity").notNull(),
    confidence: real("confidence").notNull(),

    /** question（設問への回答）| llm（自由記述からの抽出） */
    source: text("source", { enum: ANSWER_SOURCES }).notNull().default("question"),
  },
  (t) => [
    primaryKey({ columns: [t.answerId, t.questionId] }),
    // cells の集計はこのキーでの GROUP BY になります。
    index("answer_selections_cell_idx").on(t.frame, t.target, t.role),
    check("answer_selections_stance_check", sql.raw(inList("stance", STANCES))),
    check("answer_selections_frame_check", sql.raw(inList("frame", FRAMES))),
    check("answer_selections_target_check", sql.raw(inList("target", TARGETS))),
    check("answer_selections_role_check", sql.raw(inList("role", CELL_ROLES))),
    check("answer_selections_source_check", sql.raw(inList("source", ANSWER_SOURCES))),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Answer = typeof answers.$inferSelect;
export type NewAnswer = typeof answers.$inferInsert;
export type AnswerSelection = typeof answerSelections.$inferSelect;
export type NewAnswerSelection = typeof answerSelections.$inferInsert;
