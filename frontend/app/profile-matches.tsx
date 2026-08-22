import { ArrowUpRight, Compass } from "lucide-react";
import type { ProfileMatchesResponse } from "../lib/types";

export function ProfileMatches({
  savedCount,
  result,
  status,
}: {
  savedCount: number;
  result: ProfileMatchesResponse | null;
  status: "loading" | "ready" | "error";
}) {
  const colors = ["#d57a4a", "#527b6b", "#68759c"];

  if (savedCount === 0) {
    return <div className="empty-state"><Compass size={30} /><h2>まだ分析データがありません</h2><p>ニュースに関心を示すと、ここにマッチ結果が表示されます。</p></div>;
  }
  if (status === "loading") {
    return <div className="empty-state"><span className="spinner dark" /><h2>マッチを分析しています</h2></div>;
  }
  if (status === "error") {
    return <div className="empty-state"><Compass size={30} /><h2>マッチ結果を読み込めませんでした</h2><p>時間をおいて、もう一度お試しください。</p></div>;
  }
  if (!result?.reliable) {
    return <div className="empty-state"><Compass size={30} /><h2>もう少し回答が必要です</h2><p>{result?.user_summary ?? "ニュースへの考えを保存すると、マッチの精度が高まります。"}</p></div>;
  }

  return (
    <>
      <p className="profile-match-summary">{result.user_summary}</p>
      <div className="profile-match-list">
        {result.matches.map((match, index) => (
          <a className="profile-match-card" key={match.speaker_id} href={match.website} target="_blank" rel="noreferrer">
            <span className="profile-rank">{index + 1}</span>
            <div className="politician-avatar large" style={{ background: colors[index % colors.length] }}>{[...match.politician_name.replaceAll(" ", "")].slice(0, 2).join("")}</div>
            <div className="profile-match-info"><h2>{match.politician_name}</h2><p>{match.party}・{match.house}</p><div className="mini-track"><span style={{ width: `${match.match_score}%` }} /></div></div>
            <div className="profile-score"><strong>{match.match_score}<small>%</small></strong><ArrowUpRight size={16} /></div>
          </a>
        ))}
      </div>
    </>
  );
}
