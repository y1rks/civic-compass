import { FRAME_JA_PLAIN } from "@civic-compass/shared";
import type { UserProfileCell } from "../lib/types";

const ROLE_LABELS: Record<UserProfileCell["role"], string> = {
  beneficiary: "守る対象・利益を及ぼす対象",
  threat: "脅威・問題の原因",
};

const tendencyText = (score: number): string => {
  if (score === 0) return "どちらにも偏らない傾向";

  const strength = Math.abs(score) >= 0.67 ? "強く" : Math.abs(score) >= 0.34 ? "" : "やや";
  const subject = score > 0 ? "この価値を" : "ほかの価値を";
  return `${subject}${strength}優先する傾向`;
};

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
        <span>重視度 上位3件</span>
      </div>
      <p className="profile-trends-intro">回答でよく表れた「何を根拠に、誰をどう捉えたか」を表示しています。</p>

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
            const score = Math.max(-1, Math.min(1, cell.score));
            const direction = score < 0 ? "negative" : "positive";
            return (
              <article className="trend-card" key={`${cell.frame}|${cell.target}|${cell.role}`}>
                <div className="trend-card-head">
                  <span className="trend-rank">{index + 1}</span>
                  <div>
                    <h2>{FRAME_JA_PLAIN[cell.frame]}</h2>
                    <p><strong>{cell.target}</strong>を「{ROLE_LABELS[cell.role]}」として捉える</p>
                  </div>
                </div>
                <div
                  className="trend-score-chart"
                  role="img"
                  aria-label={tendencyText(score)}
                >
                  <span className="trend-chart-label left">ほかの価値を優先</span>
                  <span className="trend-chart-label right">この価値を重視</span>
                  <span className="trend-chart-axis" />
                  <span
                    className={`trend-chart-fill ${direction}`}
                    style={{ width: `${Math.abs(score) * 50}%` }}
                  />
                </div>
                <p className={`trend-score-note ${direction}`}>{tendencyText(score)}</p>
              </article>
            );
          })}
        </div>
      )}
      <p className="trend-score-help">政策への賛否ではなく、その価値を判断でどう扱ったかを表します。</p>
    </section>
  );
}
