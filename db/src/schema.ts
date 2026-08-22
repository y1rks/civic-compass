import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
    frame: text("frame").notNull(),
    /** uphold（根拠として持ち出した） | override（優先順位で下に置いた） | neutral */
    stance: text("stance").notNull(),
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
    entity: text("entity").notNull(),
    /** beneficiary（守る対象） | threat（脅威として名指す） | neutral（言及のみ） */
    role: text("role").notNull(),
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
