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

// ---------------------------------------------------------------------------
// B（意見保存直後のポップアップ）—— `GET /api/perspectives/:articleId`
//
// マッチ度は出しません。**いま答えた論点（frame × target）そのもの**を、
// 議員が国会でどう語ってきたかを並べます。合う意見だけでなく、同じ観点から
// 逆の立場で語っている議員も出します。
//
// KV 側は snake_case ですが、画面が読むのはこの型なので API の境界で
// camelCase に寄せています（他のレスポンスと揃えるため）。
// ---------------------------------------------------------------------------

/** 議員の発言1件。国会会議録由来なら原文（`excerpt`）が入ります。 */
export type PerspectiveStatement = {
  date: string | null;
  summary: string;
  url: string | null;
  /**
   * 原文を表示してよいか。議員の公式サイト由来は著作物なので `false` で、
   * `excerpt` は null になります。要約とリンクに留めてください。
   */
  quotable: boolean;
  excerpt: string | null;
};

export type PerspectivePolitician = {
  speakerId: string;
  politicianName: string;
  party: string;
  /**
   * ★この議員がその対象をどう扱ったか。**回答した設問の role とは違うことがあります**
   * （論点は frame × target で束ねていて、role では絞っていないため）。
   * `beneficiary`（守る対象）と `threat`（脅威）は正反対の思想なので、
   * カードから消してはいけません（docs/design-constraints.md「禁止事項」）。
   */
  role: string;
  /** 「守る立場」/「問題視する立場」 */
  roleLabel: string;
  /** −1〜+1。その価値を根拠として持ち出したか、優先順位で下に置いたか。 */
  score: number;
  /** 全セル中の比重（＝重視度）。 */
  share: number;
  /** 全議員平均の何倍語っているか。 */
  distinctiveness: number;
  n: number;
  /**
   * どの観点から語ったか。「被害や苦痛への配慮の観点」。
   * その価値を退けている議員だけ「（他を優先）」が付きます。
   */
  stanceText: string;
  /**
   * その議員自身の中で、この観点にどれだけ比重を置いているか（`share` の3段階）。
   *
   * `share` は本人の全セルで合計1.0になる比率なので、大きさがセル数に依存します。
   * そのため固定のしきい値ではなく、**本人の中央値との比**で判定しています。
   *
   * プロファイルを読めなかったときだけ null になります（チップを出しません）。
   */
  mentionLevel: "high" | "mid" | "low" | null;
  /** 「高」「中」「低」。`mentionLevel` が null なら null。 */
  mentionLevelLabel: string | null;
  /**
   * 「似た立場」/「異なる立場」。マッチ度ではありません。
   *
   * ★**その論点の中での相対的な近さ**で決まります。議員側の `score` は97%が
   *   +0.9以上なので、符号で分けると候補が全員同じ側に寄ってしまうためです。
   *   `positionsDivided: false` の論点では全員が同じラベルになります。
   */
  alignment: "same" | "different" | "unclear";
  /**
   * その観点での発言。最大3件。
   *
   * **先頭が代表の1件**で、画面ではこれだけを畳まずに出します（毎回変わります）。
   * 残りは「その他の答弁」に畳みます。
   */
  statements: PerspectiveStatement[];
};

/**
 * 記事の設問1つ ＝ 論点1つ。
 *
 * 議員の逆引きは **frame × target** で行い、`role` では絞りません
 * （合う意見だけでなく、同じ観点から逆の立場で語っている議員も出すため）。
 */
export type Perspective = {
  questionId: string;
  prompt: string;
  frame: string;
  /** 利用者向けの平易な frame 名。例:「被害や苦痛への配慮」 */
  frameLabel: string;
  target: string;
  /** 回答した設問の role。立場の比較の基準にだけ使い、議員側の role とは別です。 */
  role: string;
  yourStance: ArticleQuestionOption["stance"];
  /**
   * その論点で議員の立場が分かれていたか。
   *
   * `false` は「候補の全員がまったく同じ扱い方をしていた」という意味で、
   * 実データでは `care_harm × 高齢者` のように**全員 score +1.000** のセルがあります。
   * そこに差を作るのは捏造なので、画面ではその旨を断ります。
   *
   * このとき `politicians` は**2人まで**になります（対比が作れないため）。
   */
  positionsDivided: boolean;
  politicians: PerspectivePolitician[];
};

export type PerspectiveResult = {
  articleId: string;
  interest: number;
  perspectives: Perspective[];
  disclaimer: string;
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
