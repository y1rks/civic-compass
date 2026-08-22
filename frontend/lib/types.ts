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

export type ProfileMatchReason = {
  text: string;
  frame: import("@civic-compass/shared").Frame;
  target: import("@civic-compass/shared").Target;
  role: import("@civic-compass/shared").CellRole;
  contribution: number;
};

export type ProfileMatchDifference = {
  text: string;
  frame: import("@civic-compass/shared").Frame;
  target: import("@civic-compass/shared").Target;
  role: import("@civic-compass/shared").CellRole;
};

export type ProfileMatchEvidence = {
  date: string | null;
  summary: string;
  url: string;
  frame: import("@civic-compass/shared").Frame;
  target: import("@civic-compass/shared").Target;
  role: import("@civic-compass/shared").CellRole;
  quote?: string;
  highlight?: string;
};

export type PoliticianProfileMatch = {
  speaker_id: string;
  politician_name: string;
  party: string;
  house: string;
  website: string;
  match_score: number;
  matched_cells: number;
  reasons: ProfileMatchReason[];
  differences: ProfileMatchDifference[];
  evidence: ProfileMatchEvidence[];
};

export type PartyProfileMatch = {
  party: string;
  match_score: number;
  matched_cells: number;
  n_politicians: number;
};

export type ProfileMatchesResponse = {
  user_id: string;
  reliable: boolean;
  user_summary: string;
  matches: PoliticianProfileMatch[];
  party_matches: PartyProfileMatch[];
  disclaimer: string;
};

/** KV USER_PROFILES のうち、政治コンパス画面に表示する上位セル。 */
export type UserProfileCell = {
  frame: import("@civic-compass/shared").Frame;
  target: import("@civic-compass/shared").Target;
  role: import("@civic-compass/shared").CellRole;
  score: number;
  share: number;
  n: number;
};
