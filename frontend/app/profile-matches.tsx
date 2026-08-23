"use client";

import { useState } from "react";
import { ArrowUpRight, ChevronDown, Compass } from "lucide-react";
import type { PartyProfileMatch, PoliticianProfileMatch, ProfileMatchesResponse } from "../lib/types";

/**
 * 総合マッチ（C）の表示。**政治家と政党をタブで切り替えます。**
 *
 * 政治家・政党とも上位7件です（API 側で絞っています）。うち最初に出すのは3件で、
 * 残りは「もっと見る」で開きます。7件を並べたままだと縦に長く、
 * 上位との差が読み取りにくいためです。
 */
const COLORS = ["#d57a4a", "#527b6b", "#68759c", "#8a6350", "#4e615e"];

/**
 * 政党アイコンの文字色。政党色は明るいもの（チームみらい #66FFCC、国民民主党 #F8BC00）が
 * あるので、明度で白と地の色を出し分けます。白のままだと略称が読めません。
 */
function labelColor(background: string): string {
  const hex = background.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  // YIQ の輝度。0〜255 で、160 あたりが白文字と黒文字の入れ替わり目です。
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? "#183733" : "#fff";
}

/**
 * 同率は同じ順位にし、次の順位はその件数ぶん飛ばします（1, 2, 2, 4）。
 *
 * API がマッチ度の降順で返すことが前提です。順位を出さずに並び順だけで見せると、
 * 33% が2つ並んでいるのに「3位」「4位」と差があるように読めてしまいます。
 */
export function withRank<T extends { match_score: number }>(list: T[]): { item: T; rank: number }[] {
  let rank = 0;
  let previous: number | null = null;

  return list.map((item, index) => {
    if (item.match_score !== previous) rank = index + 1;
    previous = item.match_score;
    return { item, rank };
  });
}

/**
 * マッチ度の表示。API は小数第1位まで返すので、桁を揃えて出します
 * （50 と 50.4 が「50」「50.4」と混ざると、丸めた値のように見えます）。
 */
const score = (value: number): string => value.toFixed(1);

/** 畳んでいるときに見せる件数。API が返すのは最大7件です。 */
const COLLAPSED_COUNT = 3;

type MatchTab = "politicians" | "parties";

/**
 * 残りを開くボタン。開いたあとは畳み直せるようにします
 * （7件を見たあと1位に戻るのに、画面をスクロールし直させないため）。
 */
function MoreToggle({ total, expanded, onToggle, controls }: {
  total: number;
  expanded: boolean;
  onToggle: () => void;
  controls: string;
}) {
  if (total <= COLLAPSED_COUNT) return null;

  return (
    <button type="button" className="match-more" aria-expanded={expanded} aria-controls={controls} onClick={onToggle}>
      {expanded ? "閉じる" : "もっと見る"}
      <ChevronDown size={14} className={expanded ? "flipped" : ""} />
    </button>
  );
}

/** 政党プロファイルが何を根拠にしているかの断り書き。全党の出所を見て決めます。 */
function sourceNote(parties: PartyProfileMatch[]): string | null {
  if (parties.length === 0) return null;
  const kinds = new Set(parties.map((party) => party.source));
  if (kinds.size === 1 && kinds.has("members")) return "政党の傾向は、所属議員の国会での発言から集計しています。";
  if (kinds.size === 1 && kinds.has("manifesto")) return "政党の傾向は、各党が公表している公約・基本政策から集計しています。";
  return "政党の傾向は、各党の公約・基本政策を主に、所属議員の国会での発言も加えて集計しています。";
}

function PoliticianCard({ match, rank, index }: { match: PoliticianProfileMatch; rank: number; index: number }) {
  return (
    <a className="profile-match-card" href={match.website} target="_blank" rel="noreferrer">
      <span className="profile-rank">{rank}</span>
      <div className="politician-avatar large" style={{ background: COLORS[index % COLORS.length] }}>{[...match.politician_name.replaceAll(" ", "")].slice(0, 2).join("")}</div>
      <div className="profile-match-info">
        <h2>{match.politician_name}</h2>
        <p>{match.party}・{match.house}</p>
        <div className="mini-track"><span style={{ width: `${match.match_score}%` }} /></div>
      </div>
      <div className="profile-score"><strong>{score(match.match_score)}<small>%</small></strong><ArrowUpRight size={16} /></div>
      {match.summary ? <p className="match-summary">{match.summary}</p> : null}
    </a>
  );
}

function PartyCard({ match, rank }: { match: PartyProfileMatch; rank: number }) {
  const seats = [
    match.seats.shugiin > 0 ? `衆${match.seats.shugiin}` : null,
    match.seats.sangiin > 0 ? `参${match.seats.sangiin}` : null,
  ].filter(Boolean).join("・");

  return (
    <a className="profile-match-card" href={match.website} target="_blank" rel="noreferrer">
      <span className="profile-rank">{rank}</span>
      <div className="politician-avatar large party" style={{ background: match.color, color: labelColor(match.color) }}>{match.short_name}</div>
      <div className="profile-match-info">
        <h2>{match.party}</h2>
        <p>{seats.length > 0 ? `${seats}議席` : "国会に議席なし"}</p>
        <div className="mini-track"><span style={{ width: `${match.match_score}%` }} /></div>
      </div>
      <div className="profile-score"><strong>{score(match.match_score)}<small>%</small></strong><ArrowUpRight size={16} /></div>
      {match.summary ? <p className="match-summary">{match.summary}</p> : null}
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
  const [tab, setTab] = useState<MatchTab>("politicians");
  // タブごとに開閉を覚えます。切り替えのたびに畳み直すと、見比べるのに毎回開き直すことになります。
  const [expanded, setExpanded] = useState<Record<MatchTab, boolean>>({ politicians: false, parties: false });

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
  const visible = <T,>(list: T[]): T[] => (expanded[tab] ? list : list.slice(0, COLLAPSED_COUNT));
  const toggle = () => setExpanded((current) => ({ ...current, [tab]: !current[tab] }));

  return (
    <>
      {/* 出所の断り書きは見出しの直下に出します（リストの末尾だと読まれないため）。
          タブに関わらず常に出します。 */}
      {note ? <p className="match-tab-note">{note}</p> : null}
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
        <div role="tabpanel" id="match-panel-politicians" aria-labelledby="match-tab-politicians">
          <div className="profile-match-list" id="match-list-politicians">
            {visible(withRank(result.matches)).map(({ item, rank }, index) => (
              <PoliticianCard key={item.speaker_id} match={item} rank={rank} index={index} />
            ))}
          </div>
          <MoreToggle total={result.matches.length} expanded={expanded.politicians} onToggle={toggle} controls="match-list-politicians" />
        </div>
      ) : (
        <div role="tabpanel" id="match-panel-parties" aria-labelledby="match-tab-parties">
          {parties.length === 0
            ? <p className="match-tab-empty">政党のマッチはまだ計算できません。もう少しニュースへの考えを保存すると表示されます。</p>
            : (
              <>
                <div className="profile-match-list" id="match-list-parties">
                  {visible(withRank(parties)).map(({ item, rank }) => (
                    <PartyCard key={item.party_id} match={item} rank={rank} />
                  ))}
                </div>
                <MoreToggle total={parties.length} expanded={expanded.parties} onToggle={toggle} controls="match-list-parties" />
              </>
            )}
        </div>
      )}
    </>
  );
}
