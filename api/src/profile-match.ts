import {
  CELL_ROLES,
  FRAME_JA_PLAIN,
  FRAMES,
  TARGETS,
  type CellRole,
  type Frame,
  type Target,
  type UserProfile,
} from "@civic-compass/shared";

export const MIN_POLITICIAN_CELL_COUNT = 3;
export const MIN_MATCHED_CELLS = 2;
export const MIN_ANSWERS = 5;
/**
 * 「両者とも語らなかった」の重み。**κ（偶然を差し引いた一致率）は実測で平均0.19しか
 * 出ない**ので、以前の 0.3 は取れない点を分母に置いているのと同じでした。
 * 本人が回答したケースのスコアが 30pt ほど不当に下がっていたため縮めています。
 */
export const SILENT_WEIGHT = 0.05;

/** 「関心がない」と明示したセルの一致。κ の実測は平均0.53。SILENT より重いのは従来どおり。 */
export const DECLINED_WEIGHT = 0.1;

/**
 * 突出度を「一致の強さ」に直すときの倍率。
 *
 * `log(1 + distinctiveness)` は突出度が平均並み（1.0倍）だと **0.69** にしかならず、
 * 完全に一致していてもセルの share の7割しか取れませんでした。実測で本人が
 * 回答したケースの平均が 53.4% と低かった主因です（平均 agree は 0.955 と高いのに）。
 *
 * 2.0 を掛けると平均並みの突出度で満点（上限1.0）に届き、平均以下だけが割り引かれます。
 *
 * ⚠ 上げるほど「そのセルを持っているか」で決まるようになるため、**発言量の多い相手が
 *   有利**になります。実測でセル数と平均順位の相関は 1.0倍で -0.04、1.44倍で -0.30、
 *   2.0倍で -0.56。本人スコアとのトレードオフです。
 */
export const EMPHASIS_SCALE = 2;

/**
 * 議員・政党が**一度も語っていない**セルを、ユーザーが優先順位を下げたセルと
 * 突き合わせるときの重み。
 *
 * 語らなかったこと自体が情報です。公約は網羅的に掲げるものなので、
 * **載せていない＝明示的に優先順位を下げた**と読めます。答弁データでも、
 * 議員側の score は9割方 +1 に張り付く（override が稀）ので、
 * 「その価値を下に置いた」は cells の有無にしか現れません。
 *
 * これを見ないと、**ユーザーが `override` と答えた設問がどの相手にも寄与しません**。
 * 相手が語っていれば必ず +1 なので `agree = 0`、語っていなければ寄与ゼロ、
 * のどちらかにしかならないためです（実測で11セル中4セルが該当）。
 *
 * 満額にしないのは、沈黙が発言ほど強い証拠ではないからです。とくに答弁データは
 * 収集範囲で欠けることがあり、`profile:party` の公約由来ほど確かではありません。
 */
export const ABSENCE_WEIGHT = 0.3;

/** 語られなかったセルに与える仮の score。「優先順位の下に置いた」＝ override 相当。 */
const ABSENT_SCORE = -1;

/**
 * 同じ `frame × target` を**逆の role で強く語っている**ときの減点の重み。
 *
 * `beneficiary`（守る対象）と `threat`（脅威）は思想の対立です
 * （docs/design-constraints.md「セルキーから role を落とす」）。
 * 一致と同じ重み（1.0）で引くので、「守る対象として語った量」と
 * 「脅威として語った量」が釣り合えば相殺されます。
 */
export const OPPOSITE_ROLE_WEIGHT = 1;

/**
 * 「その価値を強く持ち出した」とみなす score の下限。**両側で同じ値を使います**
 * （片側だけ基準を変えると意味がずれる。docs/design-constraints.md「片側だけに補正を掛ける」）。
 *
 * 実測（1,593セル）では議員・政党の score は 25%点が +0.82、中央値 +1.00 で、
 * 0.5 を超えるものが 81.6%。0.5 未満に残るのは override を含む「向きの読めない」帯です。
 * ここを緩めると、**脅威の枠組みを持ち出したうえで退けた**発言まで減点に数えてしまいます
 * （実測で猪瀬直樹の `loyalty_community × 地方 × threat` は score −1.00）。
 */
export const STRONG_SCORE = 0.5;

const OPPOSITE_ROLE = { beneficiary: "threat", threat: "beneficiary" } as const;

/**
 * 沈黙を満額の証拠として扱う観測量（セルの `n` の合計 ＝ 抽出できたフレームの総数）。
 *
 * **観測が少ない相手ほど、語っていないセルが増えます。** 補正しないと、
 * データの薄い相手ほど「優先順位を下げた」一致を多く集めて有利になります
 * （実測で安野貴博 Σn=306 が4位→2位、斉藤鉄夫 Σn=1427 が3位→5位）。
 *
 * 1200 は議員の実測（306〜2616、中央値1364）の中央値付近です。`n_segments_valued`
 * ではなく Σn を使うのは、**政党プロファイルの `n_segments_valued` が
 * 所属議員から集計した党では 0 になる**ためで、Σn なら議員・政党どちらでも同じ意味を持ちます。
 *
 * **公約（`manifesto` / `mixed`）は量に関わらず満額**にします。公約は網羅的に
 * 掲げるものなので、載っていないこと自体が意思表示だからです。
 */
const ABSENCE_FULL_FRAMES = 1200;

export type CellKey = `${Frame}|${Target}|${CellRole}`;

export type MatchCell = {
  frame: Frame;
  target: Target;
  role: CellRole;
  score: number;
  share: number;
  n: number;
  distinctiveness?: number;
};

export type PoliticianProfile = {
  speaker_id: string;
  politician_name: string;
  party: string;
  house: string;
  cells: MatchCell[];
};

export type PartyProfile = {
  party: string;
  /** manifesto（公約のみ）| members（所属議員のみ）| mixed（両方） */
  source?: "manifesto" | "members" | "mixed";
  n_politicians: number;
  politicians: string[];
  cells: MatchCell[];
};

export type MatchReason = {
  text: string;
  frame: Frame;
  target: Target;
  role: CellRole;
  contribution: number;
};

export type MatchDifference = {
  text: string;
  frame: Frame;
  target: Target;
  role: CellRole;
};

type MatchOpposition = MatchDifference & { weight: number };

type MatchContribution = MatchReason & {
  weight: number;
  agree: number;
  userScore: number;
  politicianScore: number;
};

type MatchResultBase = {
  matched_cells: number;
  reasons: MatchReason[];
  differences: MatchDifference[];
};

export type MatchResult =
  | (MatchResultBase & { reliable: false })
  | (MatchResultBase & { reliable: true; match_score: number });

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isFrame = (value: unknown): value is Frame =>
  typeof value === "string" && (FRAMES as readonly string[]).includes(value);

const isTarget = (value: unknown): value is Target =>
  typeof value === "string" && (TARGETS as readonly string[]).includes(value);

const isCellRole = (value: unknown): value is CellRole =>
  typeof value === "string" && (CELL_ROLES as readonly string[]).includes(value);

export const cellKey = (cell: Pick<MatchCell, "frame" | "target" | "role">): CellKey =>
  `${cell.frame}|${cell.target}|${cell.role}`;

export const parseCellKey = (value: string): CellKey | null => {
  const [frame, target, role, extra] = value.split("|");
  if (extra !== undefined || !isFrame(frame) || !isTarget(target) || !isCellRole(role)) return null;
  return `${frame}|${target}|${role}`;
};

export const isMatchCell = (value: unknown): value is MatchCell => {
  if (typeof value !== "object" || value === null) return false;
  const cell = value as Record<string, unknown>;
  return isFrame(cell.frame)
    && isTarget(cell.target)
    && isCellRole(cell.role)
    && isFiniteNumber(cell.score) && cell.score >= -1 && cell.score <= 1
    && isFiniteNumber(cell.share) && cell.share >= 0 && cell.share <= 1
    && isFiniteNumber(cell.n) && Number.isInteger(cell.n) && cell.n >= 0
    && (cell.distinctiveness === undefined
      || (isFiniteNumber(cell.distinctiveness) && cell.distinctiveness >= 0));
};

export const isPoliticianProfile = (value: unknown): value is PoliticianProfile => {
  if (typeof value !== "object" || value === null) return false;
  const profile = value as Record<string, unknown>;
  return typeof profile.speaker_id === "string"
    && typeof profile.politician_name === "string"
    && typeof profile.party === "string"
    && typeof profile.house === "string"
    && Array.isArray(profile.cells)
    && profile.cells.every((cell) => isMatchCell(cell) && cell.distinctiveness !== undefined);
};

export const isPartyProfile = (value: unknown): value is PartyProfile => {
  if (typeof value !== "object" || value === null) return false;
  const profile = value as Record<string, unknown>;
  return typeof profile.party === "string"
    && (profile.source === undefined
      || profile.source === "manifesto" || profile.source === "members" || profile.source === "mixed")
    // 公約だけで作った政党は所属議員が0人になります（国会発言のない党もマッチ対象にするため）。
    && isFiniteNumber(profile.n_politicians)
    && Number.isInteger(profile.n_politicians)
    && profile.n_politicians >= 0
    && Array.isArray(profile.politicians)
    && profile.politicians.every((id) => typeof id === "string")
    && Array.isArray(profile.cells)
    && profile.cells.every(isMatchCell);
};

export const isUserProfile = (value: unknown): value is UserProfile => {
  if (typeof value !== "object" || value === null) return false;
  const profile = value as Record<string, unknown>;
  return typeof profile.user_id === "string"
    && typeof profile.computed_at === "string"
    && typeof profile.profile_version === "string"
    && isFiniteNumber(profile.n_answers) && Number.isInteger(profile.n_answers) && profile.n_answers >= 0
    && isFiniteNumber(profile.n_selections) && Number.isInteger(profile.n_selections) && profile.n_selections >= 0
    && Array.isArray(profile.cells)
    && profile.cells.every((cell) => isMatchCell(cell) && cell.distinctiveness === undefined)
    && Array.isArray(profile.declined_cells)
    && profile.declined_cells.every((cell) => {
      if (typeof cell !== "object" || cell === null) return false;
      const candidate = cell as Record<string, unknown>;
      return isFrame(candidate.frame) && isTarget(candidate.target) && isCellRole(candidate.role);
    })
    && isFiniteNumber(profile.override_rate) && profile.override_rate >= 0 && profile.override_rate <= 1
    && isFiniteNumber(profile.override_weight) && profile.override_weight >= 1;
};

const round = (value: number, digits = 3): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

const tendencyText = (cell: { frame: Frame; target: Target; score: number }): string =>
  cell.score < -0.2
    ? `${cell.target}について、${FRAME_JA_PLAIN[cell.frame]}よりもほかの価値を優先する`
    : `${cell.target}について、${FRAME_JA_PLAIN[cell.frame]}を重んじる`;

const priorityText = (cell: { frame: Frame; target: Target; score: number }): string =>
  `${tendencyText(cell)}点`;

const differenceText = (cell: MatchContribution): string => {
  const label = FRAME_JA_PLAIN[cell.frame];
  if (cell.userScore >= -0.2 && cell.politicianScore < -0.2) {
    return `${cell.target}について、あなたは${label}を重んじる一方、この議員はほかの価値を優先する傾向があります`;
  }
  if (cell.userScore < -0.2 && cell.politicianScore >= -0.2) {
    return `${cell.target}について、あなたは${label}よりもほかの価値を優先する一方、この議員は${label}を重んじる傾向があります`;
  }
  return `${cell.target}について、${label}の優先のしかたに違いがあります`;
};

/**
 * 同じ対象を、ユーザーとは逆の立場から語っているときの文面。
 *
 * `beneficiary` は「守る対象として語った」、`threat` は「脅威として名指した」で、
 * 賛否ではなく**語られ方**の分類です（docs/design-constraints.md）。
 */
const oppositionText = (cell: { frame: Frame; target: Target; role: CellRole }): string => {
  const label = FRAME_JA_PLAIN[cell.frame];
  return cell.role === "beneficiary"
    ? `${cell.target}を、あなたは${label}の観点から守る対象として語り、この相手は問題視する対象として語っています`
    : `${cell.target}を、あなたは${label}の観点から問題視する対象として語り、この相手は守る対象として語っています`;
};

/** ユーザーと議員・政党のプロファイルを、セルの完全一致だけで比較します。 */
export function calculateProfileMatch(
  user: UserProfile,
  profile: { cells: MatchCell[]; source?: PartyProfile["source"] },
  universe: ReadonlySet<CellKey>,
): MatchResult {
  const politicianCells = profile.cells.filter((cell) => cell.n >= MIN_POLITICIAN_CELL_COUNT);
  // 公約は網羅的なので沈黙を満額で信用します。発言データは観測量に応じて割り引きます。
  const observedFrames = politicianCells.reduce((total, cell) => total + cell.n, 0);
  const absenceConfidence = profile.source === "manifesto" || profile.source === "mixed"
    ? 1
    : Math.min(1, observedFrames / ABSENCE_FULL_FRAMES);
  const politicianMap = new Map(politicianCells.map((cell) => [cellKey(cell), cell]));
  const activeKeys = new Set(user.cells.map(cellKey));
  const declinedKeys = new Set(user.declined_cells.map(cellKey));
  let numerator = 0;
  let denominator = 0;
  let matchedCells = 0;
  const contributions: MatchContribution[] = [];

  for (const userCell of user.cells) {
    denominator += userCell.share;
    const politicianCell = politicianMap.get(cellKey(userCell));
    if (!politicianCell) {
      // 語っていないセルは score -1 の仮想セルとして突き合わせます。
      // ユーザーも下に置いたセルなら一致、重んじたセルなら不一致（寄与ゼロ）になります。
      const agree = Math.max(0, Math.min(1, 1 - Math.abs(userCell.score - ABSENT_SCORE) / 2));
      // ★分母からは外しません。「観測できていない」ことをデータ不足として
      //   分母から除くと、**セルの少ない相手が誰にとっても1位**になります。
      //   自己再現テスト（議員本人が設問に答えたら本人が1位に返るか）で、
      //   1位的中が 6/15 → 4/15 に落ち、安野貴博（29セル）が15人中8人で1位を占めました。
      //   発言量の少ない議員が不利なのは事実ですが、埋め合わせるとより大きく壊れます。
      numerator += userCell.share * absenceConfidence * ABSENCE_WEIGHT * agree;
      // reasons / differences には入れません。観測された発言ではないので、
      // 「この議員は◯◯を優先していない」と断定して見せると推論の表示になります。
      continue;
    }

    // 突出度を持たないセル（旧形式の政党プロファイルなど）は平均並みの1として扱います。
    const distinctiveness = politicianCell.distinctiveness ?? 1;
    // ★重みはユーザーの share、強さは**突出度**で測ります。相手の `share` を直接掛けないのは、
    //   share が「その人の全セル中の比率」なので、**セルの少ない相手ほど1セルが大きく出る**ためです。
    //   `distinctiveness` は全議員平均に対する倍率なので、セル数の影響を受けません。
    //   自己再現テストで 1位的中 6/15 → 8/15、上位3 7/15 → 13/15、
    //   セル数と平均順位の相関 r = 0.61 → -0.04（＝データ量ではなく思想で並ぶようになった）。
    const overlap = userCell.share
      * Math.min(1, Math.log(1 + Math.max(0, distinctiveness)) * EMPHASIS_SCALE);
    const agree = Math.max(0, Math.min(1, 1 - Math.abs(userCell.score - politicianCell.score) / 2));
    // 1セルが自分の share を超えて稼がないよう頭打ちにします（重み付き平均を保つため）。
    const contribution = Math.min(overlap * agree, userCell.share);

    numerator += contribution;
    matchedCells += 1;
    contributions.push({
      text: priorityText(userCell),
      frame: userCell.frame,
      target: userCell.target,
      role: userCell.role,
      contribution,
      weight: overlap,
      agree,
      userScore: userCell.score,
      politicianScore: politicianCell.score,
    });
  }

  // 同じ frame × target を逆の role で強く語っている相手を減点します。
  // ここは**観測された発言**なので、differences に出して構いません。
  const oppositions: MatchOpposition[] = [];
  for (const userCell of user.cells) {
    if (userCell.score <= STRONG_SCORE) continue;
    const opposite = politicianMap.get(cellKey({ ...userCell, role: OPPOSITE_ROLE[userCell.role] }));
    if (!opposite || opposite.score <= STRONG_SCORE) continue;

    // 一致側と同じ尺度（ユーザーの share × 突出度）で引きます。
    const weight = userCell.share
      * Math.min(1, Math.log(1 + Math.max(0, opposite.distinctiveness ?? 1)) * EMPHASIS_SCALE)
      * OPPOSITE_ROLE_WEIGHT;
    numerator -= weight;
    oppositions.push({
      text: oppositionText(userCell),
      frame: userCell.frame,
      target: userCell.target,
      // role はユーザー側のものです（reasons / differences はユーザーのセルを主語にするため）。
      // 相手がどちら側で語ったかは text が担います。
      role: userCell.role,
      weight,
    });
  }

  // ★「両者とも語らなかった」は**偶然の一致を差し引いて**数えます。
  //
  //   セルの少ない相手は、ユーザーが何を選ぼうと大半のセルを持たないので、
  //   素の一致率が自動的に高く出ます。補正しないと **薄いプロファイルほど有利**になり、
  //   実測ではセル数と平均順位の相関が r = 0.83（安野貴博29セルが誰の回答でも平均2.9位、
  //   神谷宗幣83セルが14.4位）という、思想ではなくデータ量を測る状態になっていました。
  //
  //   偶然の一致率は「相手が universe をどれだけ覆っていないか」＝ 1 - coverage。
  //   κ = (実測 - 偶然) / (1 - 偶然) で、Cohen のκと同じ考え方です。
  const coverage = universe.size === 0
    ? 0
    : [...universe].filter((key) => politicianMap.has(key)).length / universe.size;
  const chanceCorrected = (observed: number): number => (coverage <= 0
    ? 0
    : Math.max(0, Math.min(1, (observed - (1 - coverage)) / coverage)));

  const silentCandidates = [...universe].filter((key) => !activeKeys.has(key) && !declinedKeys.has(key));
  const silentAgreement = silentCandidates.length === 0
    ? 0
    : silentCandidates.filter((key) => !politicianMap.has(key)).length / silentCandidates.length;

  const declinedAgreement = declinedKeys.size === 0
    ? 0
    : [...declinedKeys].filter((key) => !politicianMap.has(key)).length / declinedKeys.size;

  // ★重み付き平均にします。分母に SILENT_WEIGHT / DECLINED_WEIGHT を入れ、
  //   セルごとの寄与を share で頭打ちにするので、**スコアは構造上 0〜100 に収まります**。
  //   以前は分子が分母を超えることが多く、1回の照合あたり平均1.3人が100%に張り付いて
  //   順位が付きませんでした。
  if (silentCandidates.length > 0) {
    numerator += chanceCorrected(silentAgreement) * SILENT_WEIGHT;
    denominator += SILENT_WEIGHT;
  }
  if (declinedKeys.size > 0) {
    numerator += chanceCorrected(declinedAgreement) * DECLINED_WEIGHT;
    denominator += DECLINED_WEIGHT;
  }

  if (denominator <= 0 || matchedCells < MIN_MATCHED_CELLS) {
    return { reliable: false, matched_cells: matchedCells, reasons: [], differences: [] };
  }

  const reasons = [...contributions]
    .sort((a, b) => b.contribution - a.contribution || cellKey(a).localeCompare(cellKey(b), "ja"))
    .slice(0, 3)
    .map(({ text, frame, target, role, contribution }) => ({
      text,
      frame,
      target,
      role,
      contribution: round(contribution),
    }));

  // 逆ロール（思想の対立）を先に出し、残りを score のずれで埋めます。
  const differences = [
    ...oppositions
      .sort((a, b) => b.weight - a.weight || cellKey(a).localeCompare(cellKey(b), "ja"))
      .map(({ weight: _weight, ...difference }) => difference),
    ...contributions
      .filter((cell) => cell.agree < 0.5)
      .sort((a, b) => b.weight - a.weight || cellKey(a).localeCompare(cellKey(b), "ja"))
      .map((cell) => ({
        text: differenceText(cell),
        frame: cell.frame,
        target: cell.target,
        role: cell.role,
      })),
  ].slice(0, 2);

  return {
    reliable: true,
    // 小数第1位まで返します。整数に丸めると、僅差の議員・政党が同率に潰れて
    // 順位（同率は同順位）が実態より多く並びます。
    match_score: round(Math.max(0, Math.min(100, (numerator / denominator) * 100)), 1),
    matched_cells: matchedCells,
    reasons,
    differences,
  };
}

export function makeUserSummary(user: UserProfile): string {
  if (user.cells.length === 0) return "ニュースへの考えを保存すると、考え方の傾向を分析できます。";
  const phrases = [...user.cells]
    .sort((a, b) => b.share - a.share || cellKey(a).localeCompare(cellKey(b), "ja"))
    .slice(0, 3)
    .map(tendencyText);
  return `${phrases.join("、")}傾向があります。`;
}
