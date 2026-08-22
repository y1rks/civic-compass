/**
 * このニュースへの関心度。
 *
 * 寄与 w = intensity × confidence × interest の interest にあたり、
 * その人がどれだけ重視しているか（= share）を決めます。
 *
 * 0 は「関心がない」という**明示的な表明**で、未回答とは別物です。
 * cells には入りませんが、`declined_cells` としてマッチに使います
 * （docs/implementing-match-api.md「回答は3つに分ける」）。
 */
export const INTEREST_LEVELS = [
  { value: 0, label: "関心がない" },
  { value: 0.5, label: "やや関心あり" },
  { value: 1, label: "関心あり" },
] as const;

export const DEFAULT_INTEREST = 1;

/**
 * 関心度に対応するラベル。保存後の一覧でも、シートで選んだのと同じ言葉を出すために使います。
 *
 * 完全一致ではなく最も近い段階を返すのは、段階を増やしても（DB 側は 0〜1 の実数）
 * 表示が壊れないようにするためです。
 */
export function interestLabel(value: number): string {
  return INTEREST_LEVELS.reduce((closest, level) =>
    Math.abs(level.value - value) < Math.abs(closest.value - value) ? level : closest,
  ).label;
}
