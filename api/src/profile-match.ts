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
export const SILENT_WEIGHT = 0.3;
export const DECLINED_WEIGHT = 0.5;

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

/** ユーザーと議員・政党のプロファイルを、セルの完全一致だけで比較します。 */
export function calculateProfileMatch(
  user: UserProfile,
  profile: { cells: MatchCell[] },
  universe: ReadonlySet<CellKey>,
): MatchResult {
  const politicianCells = profile.cells.filter((cell) => cell.n >= MIN_POLITICIAN_CELL_COUNT);
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
    if (!politicianCell) continue;

    // 突出度を持たないセル（旧形式の政党プロファイルなど）は平均並みの1として扱います。
    const distinctiveness = politicianCell.distinctiveness ?? 1;
    const overlap = Math.sqrt(userCell.share * politicianCell.share)
      * Math.log(1 + Math.max(0, distinctiveness));
    const agree = Math.max(0, Math.min(1, 1 - Math.abs(userCell.score - politicianCell.score) / 2));
    const contribution = overlap * agree;

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

  const silentCandidates = [...universe].filter((key) => !activeKeys.has(key) && !declinedKeys.has(key));
  const silentAgreement = silentCandidates.length === 0
    ? 0
    : silentCandidates.filter((key) => !politicianMap.has(key)).length / silentCandidates.length;
  numerator += silentAgreement * SILENT_WEIGHT;

  const declinedAgreement = declinedKeys.size === 0
    ? 0
    : [...declinedKeys].filter((key) => !politicianMap.has(key)).length / declinedKeys.size;
  numerator += declinedAgreement * DECLINED_WEIGHT;

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

  const differences = contributions
    .filter((cell) => cell.agree < 0.5)
    .sort((a, b) => b.weight - a.weight || cellKey(a).localeCompare(cellKey(b), "ja"))
    .slice(0, 2)
    .map((cell) => ({
      text: differenceText(cell),
      frame: cell.frame,
      target: cell.target,
      role: cell.role,
    }));

  return {
    reliable: true,
    match_score: Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100))),
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
