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
 * ★`score > 0` のセルだけを渡すこと。負のセルは「その価値を持ち出したうえで優先順位を
 *   下げた」ことを表すので、この文面だと意味が逆になります。絞り込みは
 *   api/src/routes/user-profile.ts と、下の `shown` の2箇所でやっています。
 */
const tendencySummary = (cell: UserProfileCell): string => {
  const { lens } = FRAME_LENS[cell.frame][cell.role];
  const subject = cell.role === "beneficiary" ? `${cell.target}にとって${lens}` : `${cell.target}が${lens}`;
  return `「${subject}」を重視`;
};

/** その考え方をとる人の言い分の例。`tendencySummary` と同じく `score > 0` 前提です。 */
const tendencyExamples = (cell: UserProfileCell): readonly string[] =>
  FRAME_LENS[cell.frame][cell.role].examples.map((line) => line.replaceAll("{target}", cell.target));

export function ProfileTrends({
  cells,
  status,
}: {
  cells: UserProfileCell[];
  status: "loading" | "ready" | "error";
}) {
  // API（api/src/routes/user-profile.ts）が絞っているが、ここでも絞る。
  // 負のセルが混ざると「重視」と逆の意味の文面が出てしまうため、表示する場所で保証する。
  const shown = cells.filter((cell) => cell.score > 0);

  return (
    <section className="profile-trends" aria-labelledby="profile-trends-heading">
      <div className="section-heading profile-trends-heading">
        {/* 並び順は score（その価値をどれだけ強く優先したか）の降順。
            API 側（api/src/routes/user-profile.ts）で3件に絞っている。 */}
        <div id="profile-trends-heading">あなたの考え方の傾向</div>
      </div>
      {/* 出すのはカードがあるときだけ。0件のときに「以下の価値観を…」と続けると
          そのあとの「保存していくと表示されます」と矛盾する。 */}
      {status === "ready" && shown.length > 0 && (
        <p className="profile-trends-intro">回答の結果、以下の価値観を強く優先する傾向にあります。</p>
      )}

      {status === "loading" && (
        <div className="trends-message" role="status">考え方の傾向を読み込んでいます…</div>
      )}
      {status === "error" && (
        <div className="trends-message" role="alert">考え方の傾向を読み込めませんでした。</div>
      )}
      {status === "ready" && shown.length === 0 && (
        // 保存が0件のときだけでなく、保存はあるが「優先した」セルが無いときも通る
        <div className="trends-message">ニュースに意見を保存していくと、ここに傾向が表示されます。</div>
      )}
      {status === "ready" && shown.length > 0 && (
        <div className="trend-list">
          {shown.map((cell, index) => {
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
    </section>
  );
}
