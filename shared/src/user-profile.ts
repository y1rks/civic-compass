import type { CellRole, Frame, Stance, Target } from "./vocabulary.ts";
import {
  MEAN_OVERRIDE_RATE,
  MIN_ANSWERS_FOR_OWN_RATE,
  overrideRateOf,
  overrideWeight,
  smoothedShare,
  stanceSign,
  stanceWeight,
} from "./scoring.ts";

/**
 * 【3】ユーザープロファイル。D1 の回答から作る派生データで、何度でも作り直せます。
 *
 * 議員側（KV `profile:{speaker_id}`）と**同じ形**にします。マッチ計算を対称に
 * するためで、`score` / `share` の意味がずれると `agree` が成立しません。
 *
 * ★ `distinctiveness` はユーザー側では持ちません。「議員の中でどれだけ珍しいか」を
 *   測る指標なので、母集団の違うユーザーに当てると意味が壊れます。
 */
export type UserProfile = {
  user_id: string;
  computed_at: string;
  profile_version: string;
  n_answers: number;
  n_selections: number;
  cells: {
    frame: Frame;
    target: Target;
    role: CellRole;
    score: number;
    share: number;
    n: number;
  }[];
  /**
   * 明示的に「関心がない」と表明したセル。`cells` には入れませんが、
   * マッチでは「まだ答えていない」より重く扱います
   * （docs/implementing-match-api.md「回答は3つに分ける」）。
   */
  declined_cells: { frame: Frame; target: Target; role: CellRole }[];
  override_rate: number;
  override_weight: number;
};

export const USER_PROFILE_VERSION = "user-profile-v1.0";

export const userProfileKey = (userId: string) => `profile:user:${userId}`;

const round = (value: number) => Math.round(value * 1000) / 1000;
const cellKey = (c: { frame: string; target: string; role: string }) => `${c.frame}|${c.target}|${c.role}`;

/**
 * 回答を3つに分けて集計します。
 *
 * ① interest > 0 かつ stance <> neutral … cells に入れる
 * ② interest = 0 または stance = neutral … declined_cells（明示的に降りた）
 * ③ 回答が無い                          … 何も持たない
 *
 * ★②を cells に入れてはいけません。寄与 w は 0 でも share はベイズ平滑化されて
 *   いるので 0 にならず、本当に重視しているセルとほぼ同じ share を持ってしまいます。
 *   しかも分母に入るので、そのセルを持たない議員が減点されます。
 */
/** 1つの設問回答。`interest` は記事側の値で、その記事の全設問に効きます。 */
export type SelectionRow = {
  interest: number;
  answerId: string;
  stance: Stance;
  frame: Frame;
  target: Target;
  role: CellRole;
  intensity: number;
  confidence: number;
};

/** 集計そのもの。D1 に触れないので単体で検証できます。 */
export function aggregateUserProfile(rows: SelectionRow[], userId: string, now: string): UserProfile {
  const active = rows.filter((row) => row.interest > 0 && row.stance !== "neutral");
  const declined = rows.filter((row) => row.interest === 0 || row.stance === "neutral");

  // override 率。回答が少ないうちは本人の実測値が不安定（1件でも 33% などに跳ねる）
  // なので、全議員の平均に寄せます。議員側と同じ overrideWeight() を使うこと。
  const answerCount = new Set(rows.map((row) => row.answerId)).size;
  const counts = active.reduce(
    (acc, row) => {
      if (row.stance === "uphold") acc.uphold += 1;
      else if (row.stance === "override") acc.override += 1;
      return acc;
    },
    { uphold: 0, override: 0 },
  );
  const overrideRate = answerCount >= MIN_ANSWERS_FOR_OWN_RATE ? overrideRateOf(counts) : MEAN_OVERRIDE_RATE;
  const k = overrideWeight(overrideRate);

  type Acc = { frame: Frame; target: Target; role: CellRole; n: number; num: number; denScore: number; den: number };
  const cells = new Map<string, Acc>();

  for (const row of active) {
    const key = cellKey(row);
    const cell = cells.get(key) ?? {
      frame: row.frame, target: row.target, role: row.role, n: 0, num: 0, denScore: 0, den: 0,
    };
    // 議員側の weight（答弁の本人度）にあたるものが、ユーザー側では interest。
    const w = row.intensity * row.confidence * row.interest;
    const sw = stanceWeight(row.stance, k);
    cell.n += 1;
    cell.num += stanceSign(row.stance) * w * sw;
    cell.denScore += w * sw;
    // share は素の寄与で出す。override の増幅を持ち込むと重視度が歪むため。
    cell.den += w;
    cells.set(key, cell);
  }

  const totalWeight = [...cells.values()].reduce((sum, cell) => sum + cell.den, 0);
  const cellCount = cells.size;

  const declinedKeys = new Map<string, { frame: Frame; target: Target; role: CellRole }>();
  for (const row of declined) {
    // 同じセルを積極的に語ってもいるなら、そちらを優先して declined には入れない
    if (cells.has(cellKey(row))) continue;
    declinedKeys.set(cellKey(row), { frame: row.frame, target: row.target, role: row.role });
  }

  return {
    user_id: userId,
    computed_at: now,
    profile_version: USER_PROFILE_VERSION,
    n_answers: answerCount,
    n_selections: rows.length,
    cells: [...cells.values()]
      .map((cell) => ({
        frame: cell.frame,
        target: cell.target,
        role: cell.role,
        score: cell.denScore > 0 ? round(cell.num / cell.denScore) : 0,
        share: round(smoothedShare(cell.den, totalWeight, cellCount)),
        n: cell.n,
      }))
      .sort((a, b) => b.share - a.share),
    declined_cells: [...declinedKeys.values()],
    override_rate: round(overrideRate),
    override_weight: round(k),
  };
}

