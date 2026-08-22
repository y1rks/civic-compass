/**
 * 語彙定義。**変更禁止・唯一の正**。
 *
 * 各値の意味は docs/data-reference.md「中核となる概念」に書いてあります。
 *
 * フレーム分類を変えると【1】utterances の再抽出が必要になります。
 *
 * db / api / frontend / scripts のすべてがここを参照します。
 * .mjs からは Node の型ストリップで直接読めるので、コピーを作らないこと。
 */

/** 正当化フレーム。何を根拠に語ったか。 */
export const FRAMES = [
  "care_harm",
  "fairness",
  "liberty_autonomy",
  "loyalty_community",
  "authority_order",
  "sanctity_tradition",
  "efficiency_utility",
  "procedure_rule_of_law",
  "sovereignty",
  "evidence_expertise",
] as const;

/** 配慮の対象。誰の利益・尊厳を語っているか。 */
export const TARGETS = [
  "個人",
  "家族",
  "子ども・将来世代",
  "高齢者",
  "現役世代",
  "女性",
  "障害者・マイノリティ",
  "中小企業",
  "大企業・産業",
  "地方",
  "国民全体",
  "外国人・移民",
  "国際社会",
  "自然環境",
] as const;

/**
 * uphold … その価値を根拠として持ち出した（+1）
 * override … その価値を優先順位で下に置いた（−1）。「反対」ではない
 * neutral … 言及はあるが向きが読めない（0）
 */
export const STANCES = ["uphold", "override", "neutral"] as const;

/** 抽出時の role。`neutral`（言及のみ）を含みます。 */
export const ROLES = ["beneficiary", "threat", "neutral"] as const;

/**
 * セルキーに使う role。`neutral` は情報量がほぼなく疎になるだけなので
 * cells に入れません（§3）。設問側もこの2値だけを使います。
 */
export const CELL_ROLES = ["beneficiary", "threat"] as const;

export type Frame = (typeof FRAMES)[number];
export type Target = (typeof TARGETS)[number];
export type Stance = (typeof STANCES)[number];
export type Role = (typeof ROLES)[number];
export type CellRole = (typeof CELL_ROLES)[number];

/** CHECK 制約用。`frame IN ('care_harm', ...)` を組み立てます。 */
export const inList = (column: string, values: readonly string[]): string =>
  `${column} IN (${values.map((v) => `'${v}'`).join(", ")})`;

/** docs/data-reference.md に載せている正式名称。開発者向けのレポートや監査で使います。 */
export const FRAME_JA: Record<Frame, string> = {
  care_harm: "ケア・被害",
  fairness: "公正・互恵",
  liberty_autonomy: "自由・自己決定",
  loyalty_community: "共同体・絆",
  authority_order: "権威・秩序",
  sanctity_tradition: "伝統・尊厳",
  efficiency_utility: "効率・実利",
  procedure_rule_of_law: "手続き・法の支配",
  sovereignty: "主権・自立",
  evidence_expertise: "科学・専門知",
};

/**
 * 利用者に見せる平易な表現。プロファイルの要約文や
 * B / C の理由テンプレートで使います
 * （LLM に作文させないため。docs/design-constraints.md「禁止事項」）。
 *
 * `${label}を重んじる` / `${label}よりも他の価値を優先する` という文に
 * 埋め込むので、名詞句として文に馴染む形にしてあります。
 *
 * ★守ること（どちらも利用者の目に触れる文言だから）
 *
 *   1. 価値判断を含む言い換えを入れない。
 *      `care_harm` を「弱い立場への配慮」と訳すと、誰が弱いかの線引きを
 *      UI に出すことになり、docs/design-constraints.md「中立性」に反します。
 *
 *   2. `target` を先取りする語を入れない。
 *      frame は 14種の target と自由に組み合わさります。
 *      `liberty_autonomy` は `個人` だけでなく `大企業・産業` `地方` `女性` とも
 *      組むので「個人の自由」とは訳せません。`sovereignty` も `国民全体` に限らず
 *      `地方` `中小企業` の自主性を指すことがあります。
 */
export const FRAME_JA_PLAIN: Record<Frame, string> = {
  care_harm: "被害や苦痛への配慮",
  fairness: "公正さ",
  liberty_autonomy: "自由と自己決定",
  loyalty_community: "共同体と結束",
  authority_order: "秩序と規律",
  sanctity_tradition: "伝統と尊厳",
  efficiency_utility: "効率と実利",
  procedure_rule_of_law: "手続きと法の支配",
  sovereignty: "主権と自立",
  evidence_expertise: "科学と専門知",
};
