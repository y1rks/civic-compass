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

/**
 * frame を「何を重視して判断したか」という問いの形にしたものと、その考え方の例。
 *
 * 「この価値を強く優先する傾向」だけでは `frame × target × role` の組み合わせが
 * 何を意味するのか伝わらないため、物差しの中身と、具体的な言い分まで書き下します。
 * 文面はすべてテンプレートで、LLM には作文させません
 * （docs/design-constraints.md「理由文・引用文は必ず原文から」）。
 *
 * `role` で言い方が変わります。同じ frame でも、その対象を**守る**立場で語るのと
 * **問題視する**立場で語るのは正反対の思想なので、1つの文型では書けません
 * （docs/design-constraints.md「role を落とすと設計が壊れる」）。
 *
 *   beneficiary … `${target}にとって${lens}`
 *   threat      … `${target}が${lens}`
 *
 * `examples` の `{target}` は表示時に差し替えます。**議員の実際の発言ではなく、
 * その考え方をとる人の言い分の例**なので、引用の体裁（かぎ括弧）で出しつつ
 * 出典は付けません。
 *
 * ★`FRAME_JA_PLAIN` と同じ制約を守ること。
 *
 *   1. 価値判断を含む言い換えを入れない（誰が弱いかの線引きを UI に出さない）。
 *   2. target を先取りする語を入れない。14種の target と自由に組み合わさる。
 *      「国民の」「個人の」のような限定を frame 側に入れないこと。
 *   3. どちらの立場も、その人の理屈として筋が通る形で書くこと。
 *      一方を戯画化すると、そのまま中立性の問題になる。
 */
export type FrameLens = { lens: string; examples: readonly [string, string] };

export const FRAME_LENS: Record<Frame, Record<CellRole, FrameLens>> = {
  care_harm: {
    beneficiary: {
      lens: "苦痛や被害が生じないか",
      examples: [
        "{target}が現に困っているなら、制度の建前より先に手当てすべきだ",
        "数字の上では小さな影響でも、{target}にとっては生活が立ち行かない",
      ],
    },
    threat: {
      lens: "苦痛や被害をもたらさないか",
      examples: [
        "{target}によって実際に傷つく人が出ている以上、放置はできない",
        "被害が出てからでは遅く、{target}への対応を先に決めるべきだ",
      ],
    },
  },
  fairness: {
    beneficiary: {
      lens: "負担や取り分が偏っていないか",
      examples: [
        "{target}にだけ負担が寄っているのは筋が通らない",
        "同じ条件で扱われるべきなのに、{target}が取り残されている",
      ],
    },
    threat: {
      lens: "負担や取り分の偏りを生まないか",
      examples: [
        "{target}だけが優遇されるのは公平ではない",
        "{target}が負担を免れているぶん、ほかにしわ寄せが行っている",
      ],
    },
  },
  liberty_autonomy: {
    beneficiary: {
      lens: "選ぶ余地が残されているか",
      examples: [
        "決めるのは{target}自身で、上から一律に押し付けるものではない",
        "選ばない自由も含めて、{target}に選択肢を残しておくべきだ",
      ],
    },
    threat: {
      lens: "選ぶ余地を狭めないか",
      examples: [
        "{target}の主張が通れば、ほかの人の選択肢が狭まる",
        "自由の名を借りて、{target}が他者に負担を押し付けている",
      ],
    },
  },
  loyalty_community: {
    beneficiary: {
      lens: "つながりや支え合いが保たれるか",
      examples: [
        "{target}のつながりが壊れれば、制度だけでは支えきれない",
        "{target}が互いに支え合える形を残すことが先だ",
      ],
    },
    threat: {
      lens: "つながりや支え合いを損なわないか",
      examples: [
        "{target}のふるまいが、これまでのまとまりを壊している",
        "{target}を優先すれば、支え合ってきた関係が崩れる",
      ],
    },
  },
  authority_order: {
    beneficiary: {
      lens: "秩序や規律が保たれるか",
      examples: [
        "{target}を守るには、まず決まりを実効的にする必要がある",
        "{target}の現場が回るよう、責任と権限をはっきりさせるべきだ",
      ],
    },
    threat: {
      lens: "秩序や規律を乱さないか",
      examples: [
        "{target}を放置すれば、社会の秩序が保てなくなる",
        "守らせる仕組みがなければ、{target}による混乱は広がる一方だ",
      ],
    },
  },
  sanctity_tradition: {
    beneficiary: {
      lens: "受け継がれてきたものや尊厳が損なわれないか",
      examples: [
        "{target}が積み重ねてきたものを、効率のために切り捨ててはいけない",
        "{target}の尊厳に関わることは、多数決だけで決めるべきではない",
      ],
    },
    threat: {
      lens: "受け継がれてきたものや尊厳を損なわないか",
      examples: [
        "{target}の主張は、積み重ねてきたものを軽んじている",
        "{target}に合わせて変えれば、守るべき筋が失われる",
      ],
    },
  },
  efficiency_utility: {
    beneficiary: {
      lens: "費用に見合う結果が得られるか",
      examples: [
        "{target}に回す予算は、効果が見合うかどうかで決めるべきだ",
        "財源が限られる以上、{target}への支援も費用対効果で測るしかない",
      ],
    },
    threat: {
      lens: "無駄や非効率を生まないか",
      examples: [
        "{target}に費やしているぶん、ほかに回せる資源が減っている",
        "{target}のために非効率を抱え込むのは、長い目で見て損になる",
      ],
    },
  },
  procedure_rule_of_law: {
    beneficiary: {
      lens: "決め方や手続きの筋が通っているか",
      examples: [
        "{target}に関わることほど、決め方の手順を飛ばしてはいけない",
        "結論が正しくても、{target}の意見を聞かずに決めるのは筋が通らない",
      ],
    },
    threat: {
      lens: "決め方や手続きの筋を外れていないか",
      examples: [
        "{target}のやり方は、決められた手続きを踏んでいない",
        "{target}を例外扱いすれば、ルールそのものが意味を失う",
      ],
    },
  },
  sovereignty: {
    beneficiary: {
      lens: "自分たちで決められる余地が保たれるか",
      examples: [
        "{target}が自分たちのことを自分たちで決められる形を保つべきだ",
        "外からの働きかけで、{target}の裁量が狭められてはいけない",
      ],
    },
    threat: {
      lens: "自分たちで決められる余地を狭めないか",
      examples: [
        "{target}に委ねれば、自分たちで決められる範囲が狭まっていく",
        "{target}の意向に合わせるうちに、判断の主導権を失う",
      ],
    },
  },
  evidence_expertise: {
    beneficiary: {
      lens: "事実や専門的な検討に裏づけられているか",
      examples: [
        "{target}への影響は、印象ではなくデータで確かめるべきだ",
        "{target}に関わる判断こそ、専門的な検討を経る必要がある",
      ],
    },
    threat: {
      lens: "事実や専門的な検討から外れていないか",
      examples: [
        "{target}の主張には、裏づけとなるデータがない",
        "{target}の言い分を、検証しないまま前提にすべきではない",
      ],
    },
  },
};
