import { FRAME_JA_PLAIN, FRAME_LENS } from "@civic-compass/shared";
import type { UserProfileCell } from "../lib/types";

/**
 * role を「立場」の言い方に直します。
 *
 * `beneficiary` / `threat` は「守る対象として語ったか、脅威として名指したか」という
 * 語られ方の分類なので、`守る対象・利益を及ぼす対象` のような分類名で出すと
 * 読み手が意味を取れません。frame（観点）× target（誰について）の組み合わせが
 * 1行で読めるよう、述語の形にしています。
 */
const ROLE_STANCE: Record<UserProfileCell["role"], string> = {
  beneficiary: "を守る立場",
  threat: "を問題視する立場",
};

/**
 * その価値観を重視すると、どういう判断になるのかを1文で示します。
 *
 * `score` が負のセルは「その価値を持ち出したうえで、優先順位を下げた」ことを表すので、
 * 同じ物差しを示したうえで「ほかの事情を優先する」と続けます。
 */
const tendencySummary = (cell: UserProfileCell): string => {
  const score = Math.max(-1, Math.min(1, cell.score));
  const { lens } = FRAME_LENS[cell.frame][cell.role];
  const subject = cell.role === "beneficiary" ? `${cell.target}にとって${lens}` : `${cell.target}が${lens}`;

  if (score === 0) return `「${subject}」はどちらとも決めていない`;
  return score > 0
    ? `「${subject}」を重視`
    : `「${subject}」よりも、ほかの事情を優先`;
};

/**
 * その考え方をとる人の言い分の例。
 *
 * ★`score` が正のセルにだけ出します。負のセル（その価値を持ち出したうえで優先順位を
 *   下げた）に「重視する人の言い分」を並べると、正反対のことを言っていることになります。
 */
const tendencyExamples = (cell: UserProfileCell): readonly string[] =>
  cell.score > 0
    ? FRAME_LENS[cell.frame][cell.role].examples.map((line) => line.replaceAll("{target}", cell.target))
    : [];

export function ProfileTrends({
  cells,
  status,
}: {
  cells: UserProfileCell[];
  status: "loading" | "ready" | "error";
}) {
  return (
    <section className="profile-trends" aria-labelledby="profile-trends-heading">
      <div className="section-heading profile-trends-heading">
        <div id="profile-trends-heading">あなたの考え方の傾向</div>
        {/* 並び順は score（その価値をどれだけ強く優先したか）の降順。
            API 側（api/src/routes/user-profile.ts）で3件に絞っている。 */}
        <span>傾向の強さ 上位3件</span>
      </div>
      <p className="profile-trends-intro">回答の結果、以下の価値観を強く優先する傾向にあります。</p>

      {status === "loading" && (
        <div className="trends-message" role="status">考え方の傾向を読み込んでいます…</div>
      )}
      {status === "error" && (
        <div className="trends-message" role="alert">考え方の傾向を読み込めませんでした。</div>
      )}
      {status === "ready" && cells.length === 0 && (
        <div className="trends-message">ニュースへの考えを保存すると、ここに傾向が表示されます。</div>
      )}
      {status === "ready" && cells.length > 0 && (
        <div className="trend-list">
          {cells.map((cell, index) => {
            const examples = tendencyExamples(cell);
            return (
              <article className="trend-card" key={`${cell.frame}|${cell.target}|${cell.role}`}>
                <span className="trend-rank">{index + 1}</span>
                {/* 議員カードの speaker-frame / speaker-role と同じチップの見た目にしています。
                    同じ「観点 × 立場」を指すものなので、画面をまたいで揃えます。 */}
                <h2 className="trend-title">
                  <span className="trend-frame">「{FRAME_JA_PLAIN[cell.frame]}」の観点</span>
                  <span className="trend-cross" aria-hidden="true">×</span>
                  <span className={`trend-stance ${cell.role}`}>{cell.target}{ROLE_STANCE[cell.role]}</span>
                </h2>
                <div className="trend-body">
                  {/* span で囲むのは、折り返しても各行にマーカーが乗るようにするため */}
                  <p className="trend-lead"><span>{tendencySummary(cell)}</span></p>
                  {examples.length > 0 && (
                    <div className="trend-examples">
                      <span className="trend-examples-label">例</span>
                      <ul>
                        {examples.map((line) => <li key={line}>{line}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="trend-score-help">政策への賛否ではなく、その価値を判断でどう扱ったかを表します。</p>
    </section>
  );
}
