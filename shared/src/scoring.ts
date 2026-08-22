/**
 * プロファイルの計算式。**議員側とユーザー側で必ず同じものを使います。**
 *
 * 片側だけ補正を変えると `score` / `share` のスケールが合わなくなり、
 * マッチ計算の `agree = 1 - |u.score - p.score| / 2` が意味を失います
 * （docs/design-constraints.md「片側だけに補正を掛ける」）。
 *
 * 議員側は scripts/kokkai/build-profiles.mjs（バッチ）、
 * ユーザー側は api（意見の保存時）から読みます。
 */

// --- override の稀少性重み --------------------------------------------------
//
// 実データでは uphold 93% / override 7%。単純な多数決で score を出すと、
// 1件の override が大量の uphold に埋もれて cells が +0.9 に張り付く。
//
// ただし override は「その価値を優先順位で下に置いた」という明示的な意思表示で、
// **めったに override しない人がそれをやったときほど情報量が大きい**。
// そこで override 率の逆数の対数を重みにする。distinctiveness と同じ稀少性の考え方。

const OVERRIDE_WEIGHT_CAP = 6.0;
const OVERRIDE_RATE_FLOOR = 0.005;

/**
 * 回答数が少ないうちに使う、全議員の平均 override 率（実測値）。
 *
 * ユーザーは回答が十数件しかなく、本人の override 率が不安定になります。
 * 1件しか override していない人の率は「1/3 = 33%」のように跳ね、
 * k が実態とかけ離れた値になるためです。
 */
export const MEAN_OVERRIDE_RATE = 0.066;

/** 本人の実測値に切り替える回答数のしきい値。これ未満は MEAN_OVERRIDE_RATE を使う。 */
export const MIN_ANSWERS_FOR_OWN_RATE = 10;

/** その話者が override をどれだけ使うかから、override 1件あたりの重みを決める */
export function overrideWeight(overrideRate: number): number {
  const p = Math.max(overrideRate, OVERRIDE_RATE_FLOOR);
  return Math.min(1 + Math.log(1 / p), OVERRIDE_WEIGHT_CAP);
}

/** uphold = +1 / override = -1 / neutral = 0 */
export function stanceSign(stance: string): number {
  return stance === "uphold" ? 1 : stance === "override" ? -1 : 0;
}

/** score の分子・分母では override を増幅する。share には掛けない（重視度が歪むため）。 */
export function stanceWeight(stance: string, kOverride: number): number {
  return stance === "override" ? kOverride : 1;
}

/** uphold と override の数から override 率を出す */
export function overrideRateOf(counts: { uphold: number; override: number }): number {
  const total = counts.uphold + counts.override;
  return total > 0 ? counts.override / total : 0;
}

// --- share の平滑化 ---------------------------------------------------------
//
// share は「そのセルの寄与 ÷ 全セルの寄与」なので、**分母がセルの総数に依存する**。
// 観測が少ないとセルも少なく、1セルあたりの share が大きく出てしまう。
// 実測では、同じ議員でも 30セグメント時点で share 0.248 だったセルが、
// 557セグメントでは 0.050 まで薄まった（傾向は変わっていないのに5倍の差）。
//
// そのままマッチ計算の sqrt(u.share × p.share) に渡すと、データの少ない側が
// 不当に高いスコアを取る。擬似的な寄与を足して、観測が薄いうちは
// 均等分布（1/セル数）側に引き戻す。

/** 擬似寄与。実測の「1セルあたり平均寄与」3〜8 の下限側に合わせた */
export const SHARE_PRIOR = 4.0;

/** 平滑化した share。`totalWeight` は全セルの寄与合計、`cellCount` はセル数。 */
export function smoothedShare(weight: number, totalWeight: number, cellCount: number): number {
  const denominator = totalWeight + SHARE_PRIOR * cellCount;
  return denominator > 0 ? (weight + SHARE_PRIOR) / denominator : 0;
}

// --- distinctiveness --------------------------------------------------------

/**
 * 平均に履かせる下駄。これが無いと share が約分されて消え、
 * 「そのセルを持つ議員の人数」だけで倍率が決まってしまう。
 */
export const DISTINCTIVENESS_PRIOR = 0.01;

/**
 * 突出度 = そのセルの share ÷ 全議員の平均 share。
 *
 * ★ユーザー側では計算しません。「議員の中でどれだけ珍しいか」を測る指標なので、
 *   母集団の違うユーザーに当てると意味が壊れます。掛けるのは議員側の値だけです。
 */
export function distinctiveness(share: number, meanShare: number): number {
  return (share + DISTINCTIVENESS_PRIOR) / (meanShare + DISTINCTIVENESS_PRIOR);
}
