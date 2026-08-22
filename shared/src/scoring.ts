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

/** score の分子・分母では override を増幅する。share には掛けない（言及度が歪むため）。 */
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

/** 議員側の擬似寄与。実測の「1セルあたり平均寄与」3〜14 の下限側に合わせた */
export const SHARE_PRIOR = 4.0;

/**
 * ユーザー側の擬似寄与。**議員側と同じ 4.0 を使ってはいけません。**
 *
 * 擬似寄与は「実データの寄与と同じ単位」なので、両側で同じ値にすると
 * スケールが揃うのではなく、**寄与の小さい側だけが潰れます**。
 *
 *   議員   1セルあたりの寄与 3〜14（実測15人）        → PRIOR 4.0 は同程度。ほどよく効く
 *   ユーザー 1回答の寄与は 0.7 × 0.9 × interest ≦ 0.63 → PRIOR 4.0 だと擬似寄与が実データを押し切る
 *
 * 現行の設問カタログ（8記事15設問）は**セルの重複が1つもない**ので、ユーザーのセルは
 * 必ず `n = 1`、寄与は 1件ぶんだけになります。つまり share の差を作れるのは interest だけで、
 * 生の比は最大 2:1（0.63 対 0.315）しかありません。ここに PRIOR 4.0 を当てると：
 *
 *   PRIOR 4.0  share 比 1.07倍   ← 関心度スライダーが数値に出てこない
 *   PRIOR 1.0  share 比 1.24倍
 *   PRIOR 0.5  share 比 1.39倍
 *   PRIOR 0    share 比 2.00倍（interest の生の比）
 *
 * 値は議員側と同じ比率（PRIOR ÷ 1セルあたりの寄与 ≒ 0.5〜1.3）から決めています。
 * 到達可能な寄与は 0.315〜0.63 なので 0.3〜0.4 が導出値で、記事が増えてセルが重複し始めた
 * ときに効きすぎないよう 0.5 に寄せました。
 * 意味としては「1回答ぶんに満たない擬似的な証拠を、全セルに等しく置く」。
 *
 * ★ この値は記事数・議員数が増えても変える必要がありません（実測）。
 *   - セル数が 2 → 100 に増えても share 比は 1.387倍 のまま。合計寄与が `セル数 × 平均寄与`
 *     で増えるので、比からセル数が消えるため
 *   - 同じセルの回答数 n が増えると擬似寄与の影響は自然に薄れる（n=2 で 1.56倍、n=10 で 6.02倍）。
 *     事前分布は固定値のままデータに押されるのが正しい振る舞いなので、スケールさせないこと
 *   - ユーザー側の share は議員データを一切参照しないので、議員数とは無関係
 *   見直しが要るのは **1回答あたりの寄与そのものを変えたとき**だけ（設問ごとに intensity を
 *   変える、interest の刻みを変える等）。目安は PRIOR ÷ 1回答の寄与 ≒ 0.8。
 *
 * ⚠ 現時点ではこの修正でマッチの順位はほとんど動きません。実データ15人で測ると、
 *   関心のある記事だけ答えた2人の差は 平均6.3pt（PRIOR 4.0）→ 6.8pt（PRIOR 0.5）でした。
 *   いま順位を決めているのは share の重みではなく **どのセルを持っているか**（どの記事に
 *   答えたか）です。関心度をもっと効かせたいなら、prior ではなく
 *   「同じセルを複数記事で問う」か「interest の刻みを広げる」が本筋になります。
 *
 * ★ score 側の補正（override の重み k）は議員側と必ず同じにすること。
 *   あちらは `agree = 1 - |u.score - p.score| / 2` で**差**を取るのでスケールが揃っている
 *   必要がありますが、share は `sqrt(u.share × p.share)` の**積**で、しかも両側とも
 *   合計 1.0 の分布なので、擬似寄与を別々に持っても突き合わせは壊れません。
 */
export const USER_SHARE_PRIOR = 0.5;

/**
 * 平滑化した share。`totalWeight` は全セルの寄与合計、`cellCount` はセル数。
 *
 * `prior` は寄与のスケールに合わせて渡します（議員側は既定の `SHARE_PRIOR`、
 * ユーザー側は `USER_SHARE_PRIOR`）。どの prior でも全セルの合計は 1.0 になります。
 */
export function smoothedShare(
  weight: number,
  totalWeight: number,
  cellCount: number,
  prior: number = SHARE_PRIOR,
): number {
  const denominator = totalWeight + prior * cellCount;
  return denominator > 0 ? (weight + prior) / denominator : 0;
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
