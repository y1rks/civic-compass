import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { CELL_ROLES, FRAME_JA_PLAIN, type CellRole, type Frame, type Stance, type Target } from "@civic-compass/shared";
import { answerSelections, answers as answersTable, articleQuestions, createDb } from "@civic-compass/db";
import type { AppEnv } from "../bindings";
import { CURRENT_USER_ID } from "../current-user";

/**
 * B（意見保存直後のポップアップ）。
 *
 * 「あなたと何%似ています」ではなく、**いま答えた論点そのもの**を議員が
 * 国会でどう語ってきたかを見せます。単位は記事の設問と同じセル
 * （`frame × target × role`）です。
 *
 *   直前の回答（D1 answer_selections）
 *     ↓ frame × target（★role では絞りません）
 *   cellidx:{frame|target|beneficiary} と {…|threat}（KV）
 *     ↓ 両方の role を束ね、回答との近さで二分して3人選ぶ
 *       （classifyByCloseness → pickPoliticians）
 *   profile:evidence:{id}（KV）   … その3人ぶんの発言原文
 *
 * ★`role` で絞らないのは、**合う意見だけでなく合わない意見も見せる**画面だからです。
 *   ただし `role` を**表示から消してはいけません**（docs/design-constraints.md「禁止事項」）。
 *   `care_harm × 外国人・移民 × beneficiary`（支援すべき）と `× threat`（治安上の懸念）は
 *   正反対の思想なので、どちらの立場の発言なのかは必ずカードに出します。
 *
 * ★ユーザープロファイル（`profile:user:*`）は読みません。
 *   累積の傾向で見るのは C（マッチ度API）の役割で、B は1件の回答だけを見ます。
 *
 * ★LLM は使いません。文面はすべてテンプレートで、引用は evidence の原文そのまま。
 *   政治テーマでの捏造は致命傷なので、作文させる余地を作らないためです
 *   （docs/design-constraints.md「禁止事項」）。
 */
const perspectives = new Hono<AppEnv>();

/** 論点の上限。いまの記事は設問1〜2問ですが、増えても読み込み量が跳ねないように。 */
const MAX_PERSPECTIVES = 3;

/** 1つの論点で見せる議員の数。「似た立場」と「異なる立場」が両方そろっているとき。 */
const POLITICIANS_PER_TOPIC = 3;

/**
 * 片方の立場しか無い論点で見せる数。
 *
 * 対比が作れないので、同じ立場の議員を3人並べても読み取れることが増えません。
 * 数を減らして「ここは立場が分かれていない」と分かる見た目にします。
 */
const POLITICIANS_WITHOUT_CONTRAST = 2;

/**
 * evidence の読み込み上限。
 *
 * **見せる議員を先に決めてから読みます。** evidence は1人 0.2〜3MB あるので、
 * 該当する議員を全員読むと十数MBになります（`cellidx` の全行に evidence が
 * あることは確認済みなので、先に絞っても取りこぼしません）。
 *
 * 論点をまたいでも同じ議員が出るだけなので、`speaker_id` で重複を除けば
 * 読み込み量は 論点数 × 3 で頭打ちになります。
 */
const MAX_EVIDENCE_READS = MAX_PERSPECTIVES * POLITICIANS_PER_TOPIC;

/**
 * 近さがこれ以下しか散らばっていなければ、「立場が分かれていない論点」とみなします。
 * 無理に二分すると、まったく同じ score の議員に別のラベルを付けることになるためです。
 */
const CLOSENESS_EPSILON = 0.02;

/** `score` を「その価値を持ち出した／退けた」と言い切れる下限。これ未満は両方あると書きます。 */
const STANCE_THRESHOLD = 0.2;

/** KV `cellidx:{frame}|{target}|{role}` の値。share の降順で入っています。 */
type CellIndexEntry = {
  speaker_id: string;
  politician_name: string;
  party: string;
  score: number;
  share: number;
  distinctiveness: number;
  n: number;
};

/**
 * 逆引きの結果に、それがどのセルの行だったかを戻したもの。
 *
 * `cellidx` の値はセルキーを持たない（キー側にあるので）ため、role をまたいで
 * 束ねると**どちらの立場の発言か分からなくなります**。ここで持ち直します。
 */
type CellCandidate = CellIndexEntry & { frame: Frame; target: Target; role: CellRole };

/** KV `profile:{speaker_id}` の値。言及度の判定に、その議員の share の分布だけを使います。 */
type PoliticianProfile = { cells: { share: number }[] };

/** KV `profile:evidence:{speaker_id}` の値。`cells` のキーは `frame|target|role`。 */
type EvidenceDocument = {
  speaker_id: string;
  cells: Record<string, EvidenceItem[] | undefined>;
};

type EvidenceItem = {
  date?: string | null;
  summary: string;
  url?: string | null;
  /** 国会会議録（公文書）のときだけ入ります。無いものは原文を出せません。 */
  quote?: string;
  block_text?: string | null;
  evidence_text?: string;
  evidence_span?: [number, number];
};

/** evidence と cellidx のキー。`role` まで含む3要素です。 */
const cellKey = (cell: { frame: string; target: string; role: string }) =>
  `${cell.frame}|${cell.target}|${cell.role}`;

/** 論点のキー。**逆引きはこちら**で、`role` の違う発言も同じ論点に集めます。 */
const topicKey = (cell: { frame: string; target: string }) => `${cell.frame}|${cell.target}`;

/**
 * その対象をどう扱ったか。**語り手の見方**として書きます。
 *
 * `threat` を「問題の原因として」とは書きません。因果を主張しているのではなく、
 * 「警戒すべきものとして語った」という意味だからです。守る対象として語る場合も
 * その対象は論点そのものなので、「問題の原因」では向きが読み取れません。
 */
const roleLabel = (role: CellRole) => (role === "beneficiary" ? "守る立場" : "問題視する立場");

/**
 * どの観点（frame）から語ったか。役割ラベルの隣に並べるチップなので短くします。
 *
 * `score` は「支持したか退けたか」ではなく **「根拠として持ち出したか（uphold）／
 * 優先順位で下に置いたか（override）」** です。賛否と読める言い回しにしないこと
 * （docs/design-constraints.md「ユーザー側の入力（記事の設問）」）。
 *
 * 大半は uphold なので素の「〜の観点」にし、**そうでないときだけ**括弧で補います。
 * ここを一律「〜の観点」にすると score（3指標の1つ）が画面から消えてしまいます。
 */
function stanceText(frame: Frame, score: number): string {
  const label = FRAME_JA_PLAIN[frame];
  if (score > STANCE_THRESHOLD) return `${label}の観点`;
  if (score < -STANCE_THRESHOLD) return `${label}の観点（他を優先）`;
  return `${label}の観点（一定でない）`;
}

/** その議員が特に語っている観点とみなす倍率（本人の中央値に対して）。 */
const HIGH_SHARE_RATIO = 1.5;
/** 逆に、あまり語っていない観点とみなす倍率。 */
const LOW_SHARE_RATIO = 0.75;

type MentionLevel = "high" | "mid" | "low";

const MENTION_LEVEL_LABEL: Record<MentionLevel, string> = { high: "高", mid: "中", low: "低" };

/**
 * その議員が、その観点にどれだけ比重を置いているか（`share` の3段階）。
 *
 * ★**固定のしきい値では判定できません。** `share` は「そのセルの寄与 ÷ 全セルの寄与」で、
 *   分母がその議員の持つセル数に依存するためです（docs/data-reference.md の
 *   「share も平滑化する」）。実データでも、セルが7個の議員は最小でも 0.110、
 *   83個の議員は中央値が 0.005 で、固定値で切ると**発言量の差がそのままラベルになります**。
 *
 *   そこで**その議員自身の中央値との比**で見ます。「この人の平均的な観点と比べて
 *   よく語っているか」になるので、議員をまたいでも同じ意味で読めます。
 */
function mentionLevel(share: number, ownShares: number[]): MentionLevel | null {
  if (ownShares.length === 0) return null;
  const sorted = [...ownShares].sort((a, b) => a - b);
  const middle = sorted.length % 2 === 1
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  if (middle <= 0) return null;
  if (share >= middle * HIGH_SHARE_RATIO) return "high";
  if (share < middle * LOW_SHARE_RATIO) return "low";
  return "mid";
}


/**
 * 回答の向きと議員の向きが揃っているか。
 *
 * **マッチ度ではありません。** セル1つでの向きの比較で、%にはしません
 * （score は実データの97%が +0.9以上なので、数値化しても差になりません）。
 *
 * ★`role` が違う発言では向きを比べません。`beneficiary`（守る対象）と
 *   `threat`（脅威）はどちらも uphold になり得るので、score の符号だけで
 *   揃っていると判定すると正反対の思想を「同じ向き」と出してしまいます。
 */
type Alignment = "same" | "different" | "unclear";

/**
 * 回答と議員の近さ（0〜1）。マッチ計算の `agree` と同じ式です。
 * 1件の回答なので `u.score` は stance の符号（±1）になります。
 *
 * ★`role` が違う発言は最も遠い（0）とします。`beneficiary`（守る対象）と
 *   `threat`（問題の原因）は設計上「正反対の思想」なので
 *   （docs/design-constraints.md「禁止事項」）、score の符号では比べません。
 */
function closenessOf(
  answer: { stance: Stance; role: CellRole },
  politician: { score: number; role: CellRole },
): number {
  if (answer.role !== politician.role) return 0;
  const user = answer.stance === "uphold" ? 1 : -1;
  return 1 - Math.abs(user - politician.score) / 2;
}

/**
 * 論点ごとに「似た立場」と「異なる立場」に分けます。
 *
 * ★**符号ではなく、その論点の中での相対的な近さで分けます。**
 *   議員側の `score` は97%が +0.9以上なので（docs/data-reference.md）、
 *   符号で分けると候補が全員同じ側に寄ります。実データで数えると、記事の設問15問のうち
 *   符号が割れるのは2問だけでした。それでは「両方の立場を見せる」画面になりません。
 *
 *   近さの最大と最小の**中点**で二分します。最大値の議員は必ず「似た立場」、
 *   最小値の議員は必ず「異なる立場」に入るので、**両方が必ず1人以上**になります。
 *   同じ近さの議員が別のラベルになることもありません（値だけで判定しているため）。
 *
 * ★片方の立場しか無い論点は、`pickPoliticians` が2人までに減らします。
 *
 * ★全員の近さが同じ論点では二分しません。実データでは
 *   `care_harm × 高齢者` のように、**議員14人全員が score +1.000** というセルがあります。
 *   そこに差を作るのは捏造なので、`divided: false` を返して画面に断りを出します。
 */
function classifyByCloseness<T extends { score: number; role: CellRole }>(
  answer: { stance: Stance; role: CellRole },
  candidates: T[],
): { classified: (T & { alignment: Alignment })[]; divided: boolean } {
  // 「どちらとも言えない」と答えた人には比較の基準がありません。
  if (answer.stance === "neutral" || candidates.length === 0) {
    return { classified: candidates.map((c) => ({ ...c, alignment: "unclear" as Alignment })), divided: false };
  }

  const scored = candidates.map((c) => ({ candidate: c, closeness: closenessOf(answer, c) }));
  const values = scored.map((x) => x.closeness);
  const max = Math.max(...values);
  const min = Math.min(...values);

  // 立場が分かれていない論点。近さは全員同じなので、ラベルは絶対値で決めます。
  if (max - min <= CLOSENESS_EPSILON) {
    const alignment: Alignment = max >= 0.5 ? "same" : "different";
    return { classified: scored.map((x) => ({ ...x.candidate, alignment })), divided: false };
  }

  const middle = (max + min) / 2;
  return {
    classified: scored.map((x) => ({
      ...x.candidate,
      alignment: x.closeness > middle ? "same" : x.closeness < middle ? "different" : "unclear",
    })),
    divided: true,
  };
}

/** Fisher-Yates。同じ条件の議員の中では毎回違う人が出るようにします。 */
function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * 1つの論点で見せる議員を選びます。
 *
 * ① 「似た立場」と「異なる立場」から最低1人ずつ
 * ② 残りの枠は、**人数の多いほう**から埋める
 * ③ 同じ条件の中ではランダム
 *
 * ★片側が0人になることは珍しくありません。議員側の `score` は97%が +0.9以上なので
 *   （docs/data-reference.md「score の読み方に注意」）、回答の `stance` によっては
 *   全員が同じ側に寄ります。その場合はもう片方から埋めます。
 *
 * 向きを比べられなかった議員（`unclear`）は、①②で埋まらなかったときだけ使います。
 */
function pickPoliticians<T extends { speaker_id: string; alignment: Alignment; share: number }>(
  candidates: T[],
): T[] {
  const same = shuffle(candidates.filter((c) => c.alignment === "same"));
  const different = shuffle(candidates.filter((c) => c.alignment === "different"));
  const unclear = shuffle(candidates.filter((c) => c.alignment === "unclear"));

  // 片方の立場が存在しない論点は2人まで。対比にならないため。
  const limit = same.length > 0 && different.length > 0 ? POLITICIANS_PER_TOPIC : POLITICIANS_WITHOUT_CONTRAST;

  const picked: T[] = [];
  const used = new Set<string>();

  /** 1人取る。同じ議員は2枚出しません（role 違いで両方の側に載っていることがあるため）。 */
  const take = (pool: T[]): boolean => {
    while (pool.length > 0) {
      const next = pool.shift() as T;
      if (used.has(next.speaker_id)) continue;
      used.add(next.speaker_id);
      picked.push(next);
      return true;
    }
    return false;
  };

  // ★少ないほうから先に取ります。多いほうを先に取ると、少ないほうの唯一の候補が
  //   「もう出した議員」で潰れて、片方の立場が消えることがあります。
  //   「割合がより多い方」は**1人ずつ取る前の人数**で決めます。
  const [scarce, plenty] = same.length <= different.length ? [same, different] : [different, same];
  take(scarce);
  take(plenty);

  // 残りの枠は人数の多いほうから。尽きたらもう片方、それも尽きたら判定できなかった議員。
  for (const pool of [plenty, scarce, unclear]) {
    while (picked.length < limit && take(pool)) { /* 埋まるまで */ }
  }

  // 並びは「どれだけ語っているか」の順に戻します。立場の別はカードのラベルが担います。
  return picked.sort((a, b) => b.share - a.share);
}

/**
 * 代表の1件を先頭に寄せます。画面はここだけを畳まずに出し、残りは
 * 「その他の答弁」に隠します。**どれが代表になるかは毎回変わります。**
 *
 * 並べ替えではなく先頭への移動にしているのは、残りの順序
 * （`intensity × confidence × 新しさ` の降順）を保つためです。
 */
function featureOne<T>(items: T[]): T[] {
  if (items.length <= 1) return items;
  const index = Math.floor(Math.random() * items.length);
  return [items[index], ...items.slice(0, index), ...items.slice(index + 1)];
}

/**
 * evidence 1件を表示用に整えます。
 *
 * ★著作権の出し分け（docs/design-constraints.md「著作権」）。
 *   `quote` が無いエントリは議員の公式サイト由来＝著作物なので、
 *   原文を出さず要約とリンクに留めます。
 */
function toStatement(item: EvidenceItem) {
  const quotable = typeof item.quote === "string" && item.quote.length > 0;
  // block_text が null なら quote がブロック全文（同じ文字列を二重に持たないための省略）。
  const full = item.block_text ?? item.quote ?? "";
  const span = item.evidence_span;
  const fromSpan = span && full.length > 0 ? full.slice(span[0], span[1]) : "";
  const excerpt = item.evidence_text && item.evidence_text.length > 0 ? item.evidence_text : fromSpan || full;

  return {
    date: item.date ?? null,
    summary: item.summary,
    url: item.url ?? null,
    quotable,
    excerpt: quotable ? excerpt : null,
  };
}

/**
 * 直前に保存した意見を、記事の設問ごとに議員の答弁と並べて返します。
 *
 * ユーザーの特定はサーバー側で完結しているので、受け取るのは記事IDだけです。
 */
perspectives.get("/:articleId", async (c) => {
  const articleId = c.req.param("articleId");
  if (articleId.length === 0) {
    return c.json({ status: "error", message: "articleId is required" }, 400);
  }

  const db = createDb(c.env.DB);

  // 回答時点のセルは answer_selections に固定されています。設問を直しても
  // 過去の回答の意味が変わらないよう、frame / target / role はこちらを使います。
  // 選んだ文面は画面に出さないので引きません（自分の回答を見せる画面ではないため）。
  const rows = await db
    .select({
      interest: answersTable.interest,
      questionId: answerSelections.questionId,
      prompt: articleQuestions.prompt,
      stance: answerSelections.stance,
      frame: answerSelections.frame,
      target: answerSelections.target,
      role: answerSelections.role,
    })
    .from(answerSelections)
    .innerJoin(answersTable, eq(answersTable.answerId, answerSelections.answerId))
    .innerJoin(articleQuestions, eq(articleQuestions.id, answerSelections.questionId))
    .where(and(eq(answersTable.userId, CURRENT_USER_ID), eq(answersTable.articleId, articleId)))
    .orderBy(asc(articleQuestions.displayOrder));

  if (rows.length === 0) {
    return c.json({ status: "error", message: "この記事にはまだ意見が保存されていません" }, 404);
  }

  const answered = rows.slice(0, MAX_PERSPECTIVES);

  // ① セル逆引き。**role では絞らず**、beneficiary と threat の両方を読んで束ねます。
  //    合う意見だけでなく、同じ観点から逆の立場で語っている議員も出すためです。
  const topics = [...new Map(answered.map((row) => [topicKey(row), row])).values()];
  const candidatesByTopic = new Map<string, CellCandidate[]>();
  await Promise.all(
    topics.map(async (topic) => {
      const lists = await Promise.all(
        CELL_ROLES.map(async (role) => {
          const list = await c.env.PROFILES.get<CellIndexEntry[]>(`cellidx:${topicKey(topic)}|${role}`, "json");
          // どちらの立場の発言かを後段で出せるよう、セルキーを entry に戻して束ねます。
          return (list ?? []).map((entry) => ({ ...entry, frame: topic.frame, target: topic.target, role }));
        }),
      );
      candidatesByTopic.set(topicKey(topic), lists.flat().sort((a, b) => b.share - a.share));
    }),
  );

  /** 論点1つぶんの議員。role をまたいで share の降順に並んでいます。 */
  const politiciansOf = (row: { frame: Frame; target: Target }) => candidatesByTopic.get(topicKey(row)) ?? [];

  // ② 立場を判定し、論点ごとに見せる3人を決めます。**evidence を読むのはこの後**です。
  //    先に読むと該当する議員を全員ぶん（十数MB）読むことになります。
  const selections = answered.map((row) => {
    const { classified, divided } = classifyByCloseness(row, politiciansOf(row));
    return { row, divided, picked: pickPoliticians(classified) };
  });

  // ③ 選ばれた議員の evidence だけを読みます。論点をまたいで同じ議員が出るので重複を除きます。
  const speakerIds = [...new Set(selections.flatMap((s) => s.picked.map((p) => p.speaker_id)))];
  // プロファイル本体も読みます。言及度の判定に、その議員の share の分布が要るためです
  // （議員あたり十数KB。evidence の 0.2〜3MB に比べれば無視できます）。
  const evidenceById = new Map<string, EvidenceDocument | null>();
  const sharesById = new Map<string, number[]>();
  await Promise.all(
    speakerIds.slice(0, MAX_EVIDENCE_READS).flatMap((speakerId) => [
      c.env.PROFILES.get<EvidenceDocument>(`profile:evidence:${speakerId}`, "json")
        .then((doc) => { evidenceById.set(speakerId, doc); }),
      c.env.PROFILES.get<PoliticianProfile>(`profile:${speakerId}`, "json")
        .then((profile) => { sharesById.set(speakerId, (profile?.cells ?? []).map((cell) => cell.share)); }),
    ]),
  );

  const body = selections.map(({ row, divided, picked }) => ({
    questionId: row.questionId,
    prompt: row.prompt,
    frame: row.frame,
    frameLabel: FRAME_JA_PLAIN[row.frame],
    target: row.target,
    // 回答した設問の role。議員側は role をまたぐので、比較の基準としてだけ使います。
    role: row.role,
    yourStance: row.stance,
    // false なら、その論点では議員の立場に差が無かったということ。画面で断ります。
    positionsDivided: divided,
    politicians: picked
      .map((entry) => {
        // その議員自身の中で、この観点にどれだけ比重を置いているか
        const level = mentionLevel(entry.share, sharesById.get(entry.speaker_id) ?? []);

        return {
          speakerId: entry.speaker_id,
          politicianName: entry.politician_name,
          party: entry.party,
          // ★この議員がその対象をどう扱ったか。回答側の role とは違うことがあります。
          role: entry.role,
          roleLabel: roleLabel(entry.role),
          score: entry.score,
          share: entry.share,
          distinctiveness: entry.distinctiveness,
          n: entry.n,
          stanceText: stanceText(row.frame, entry.score),
          mentionLevel: level,
          mentionLevelLabel: level === null ? null : MENTION_LEVEL_LABEL[level],
          alignment: entry.alignment,
          // evidence は1セルにつき最大3件。絞らずすべて返し、先頭が代表の1件になります。
          statements: featureOne((evidenceById.get(entry.speaker_id)?.cells[cellKey(entry)] ?? []).map(toStatement)),
        };
      })
      // 発言を出せない議員は載せません。このポップアップの中身は「どう答えたか」なので、
      // 引用が無いカードは目的を果たしません。
      .filter((politician) => politician.statements.length > 0),
  }));

  return c.json({
    articleId,
    interest: rows[0].interest,
    perspectives: body,
    disclaimer: "これは参考情報であり、投票の推奨ではありません。発言は国会会議録から引用しています。",
  });
});

export default perspectives;
