/**
 * このニュースへの関心度。
 *
 * 寄与 w = intensity × confidence × interest の interest にあたり、
 * その人がどれだけ重視しているか（= share）を決めます。
 *
 * 0 は「関心なし」という**明示的な表明**で、未回答とは別物です。
 * cells には入りませんが、`declined_cells` としてマッチに使います
 * （docs/implementing-match-api.md「回答は3つに分ける」）。
 *
 * 4段階を等間隔（0 / 0.33 / 0.66 / 1）に置いているのは、UI が目盛りの位置と
 * 値を1対1で対応させるためです。段階を足すときも等間隔を保ってください。
 */
export const INTEREST_LEVELS = [
  { value: 0, label: "関心なし" },
  { value: 0.33, label: "あまり関心なし" },
  { value: 0.66, label: "やや関心あり" },
  { value: 1, label: "関心あり" },
] as const;

export const DEFAULT_INTEREST = 1;

/**
 * 関心度に最も近い段階。
 *
 * 完全一致ではなく最も近い段階を返すのは、段階を増やしても（DB 側は 0〜1 の実数）
 * 保存済みの回答の表示が壊れないようにするためです。
 */
export function nearestInterestLevel(value: number): (typeof INTEREST_LEVELS)[number] {
  return INTEREST_LEVELS.reduce((closest, level) =>
    Math.abs(level.value - value) < Math.abs(closest.value - value) ? level : closest,
  );
}

/** 関心度に対応するラベル。シートで選んだのと同じ言葉を一覧のバッジでも出すために使います。 */
export function interestLabel(value: number): string {
  return nearestInterestLevel(value).label;
}

/**
 * 関心度を目盛りの位置（0 起点の添字）に直します。
 *
 * スライダーは離散値の入力なので、`input[type=range]` には値そのものではなく
 * 添字を持たせます。0.33 のような刻みを step に指定すると浮動小数の誤差で
 * 端が選べなくなるためです。
 */
export function interestIndex(value: number): number {
  return INTEREST_LEVELS.indexOf(nearestInterestLevel(value));
}

/**
 * 一覧のバッジで「関心を示した記事」として扱うか。**表示専用の判定です。**
 *
 * 集計側のしきい値（`interest > 0` なら cells に入る）とは別物で、
 * `あまり関心なし` にチェックマークが付くのを避けるためだけのものです。
 * 段階の後半（`やや関心あり` 以上）を「あり」とみなします。
 */
export function isInterested(value: number): boolean {
  return interestIndex(value) >= INTEREST_LEVELS.length / 2;
}
