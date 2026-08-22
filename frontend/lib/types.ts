/**
 * 設問の選択肢。画面に出すのは `label` だけです。
 *
 * `stance` は「その価値を根拠として持ち出したか（uphold）、優先順位で下に
 * 置いたか（override）」という分類で、賛成／反対ではありません。
 * ラベルとして表示すると必ず賛否と誤解されるので、意味は文面が担います。
 */
export type ArticleQuestionOption = {
  id: string;
  stance: "uphold" | "override" | "neutral";
  label: string;
};

/** 記事の争点。frame × target × role のセル1つに対応します。 */
export type ArticleQuestion = {
  id: string;
  prompt: string;
  frame: string;
  target: string;
  role: string;
  options: ArticleQuestionOption[];
};

export type Article = {
  id: string;
  category: string;
  title: string;
  summary: string;
  body: string[];
  image: string;
  source: string;
  publishedAt: string;
  questions: ArticleQuestion[];
};

/** 保存済みの「この記事への意見」。D1 の answers / answer_selections に対応します。 */
export type SavedAnswer = {
  articleId: string;
  /** このニュースへの関心度（0 / 0.5 / 1）。寄与 w に掛かります。 */
  interest: number;
  comment: string;
  /** 設問ID → 選んだ stance */
  selections: Record<string, ArticleQuestionOption["stance"]>;
  savedAt: string;
};

export type Match = {
  id: string;
  name: string;
  initials: string;
  party: string;
  area: string;
  score: number;
  reason: string;
  color: string;
  website: string;
};
