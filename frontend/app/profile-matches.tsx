"use client";

import { useState } from "react";
import { ArrowUpRight, Compass } from "lucide-react";
import type { PartyProfileMatch, PoliticianProfileMatch, ProfileMatchesResponse } from "../lib/types";

/**
 * 総合マッチ（C）の表示。**政治家と政党をタブで切り替えます。**
 *
 * 政治家・政党とも上位7件です（API 側で絞っています）。
 */
const COLORS = ["#d57a4a", "#527b6b", "#68759c", "#8a6350", "#4e615e"];

/** 政党プロファイルが何を根拠にしているかの断り書き。全党の出所を見て決めます。 */
function sourceNote(parties: PartyProfileMatch[]): string | null {
  if (parties.length === 0) return null;
  const kinds = new Set(parties.map((party) => party.source));
  if (kinds.size === 1 && kinds.has("members")) return "政党の傾向は、所属議員の国会での発言から集計しています。";
  if (kinds.size === 1 && kinds.has("manifesto")) return "政党の傾向は、各党が公表している公約・基本政策から集計しています。";
  return "政党の傾向は、各党の公約・基本政策を主に、所属議員の国会での発言も加えて集計しています。";
}

function PoliticianCard({ match, index }: { match: PoliticianProfileMatch; index: number }) {
  return (
    <a className="profile-match-card" href={match.website} target="_blank" rel="noreferrer">
      <span className="profile-rank">{index + 1}</span>
      <div className="politician-avatar large" style={{ background: COLORS[index % COLORS.length] }}>{[...match.politician_name.replaceAll(" ", "")].slice(0, 2).join("")}</div>
      <div className="profile-match-info">
        <h2>{match.politician_name}</h2>
        <p>{match.party}・{match.house}</p>
        <div className="mini-track"><span style={{ width: `${match.match_score}%` }} /></div>
      </div>
      <div className="profile-score"><strong>{match.match_score}<small>%</small></strong><ArrowUpRight size={16} /></div>
    </a>
  );
}

function PartyCard({ match, index }: { match: PartyProfileMatch; index: number }) {
  const seats = [
    match.seats.shugiin > 0 ? `衆${match.seats.shugiin}` : null,
    match.seats.sangiin > 0 ? `参${match.seats.sangiin}` : null,
  ].filter(Boolean).join("・");

  return (
    <a className="profile-match-card" href={match.website} target="_blank" rel="noreferrer">
      <span className="profile-rank">{index + 1}</span>
      <div className="politician-avatar large party" style={{ background: COLORS[index % COLORS.length] }}>{match.short_name}</div>
      <div className="profile-match-info">
        <h2>{match.party}</h2>
        <p>{seats.length > 0 ? `${seats}議席` : "国会に議席なし"}</p>
        <div className="mini-track"><span style={{ width: `${match.match_score}%` }} /></div>
      </div>
      <div className="profile-score"><strong>{match.match_score}<small>%</small></strong><ArrowUpRight size={16} /></div>
    </a>
  );
}

export function ProfileMatches({
  savedCount,
  result,
  status,
}: {
  savedCount: number;
  result: ProfileMatchesResponse | null;
  status: "loading" | "ready" | "error";
}) {
  const [tab, setTab] = useState<"politicians" | "parties">("politicians");

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

  const parties = result.party_matches;
  const note = sourceNote(parties);

  return (
    <>
      <p className="profile-match-summary">{result.user_summary}</p>
      <div className="match-tabs" role="tablist" aria-label="マッチの表示対象">
        <button
          type="button"
          role="tab"
          id="match-tab-politicians"
          aria-selected={tab === "politicians"}
          aria-controls="match-panel-politicians"
          onClick={() => setTab("politicians")}
        >
          政治家
        </button>
        <button
          type="button"
          role="tab"
          id="match-tab-parties"
          aria-selected={tab === "parties"}
          aria-controls="match-panel-parties"
          onClick={() => setTab("parties")}
        >
          政党
        </button>
      </div>
      {tab === "politicians" ? (
        <div className="profile-match-list" role="tabpanel" id="match-panel-politicians" aria-labelledby="match-tab-politicians">
          {result.matches.map((match, index) => <PoliticianCard key={match.speaker_id} match={match} index={index} />)}
        </div>
      ) : (
        <div role="tabpanel" id="match-panel-parties" aria-labelledby="match-tab-parties">
          {parties.length === 0
            ? <p className="match-tab-empty">政党のマッチはまだ計算できません。もう少しニュースへの考えを保存すると表示されます。</p>
            : (
              <>
                <div className="profile-match-list">
                  {parties.map((match, index) => <PartyCard key={match.party_id} match={match} index={index} />)}
                </div>
                {note ? <p className="match-tab-note">{note}</p> : null}
              </>
            )}
        </div>
      )}
    </>
  );
}
