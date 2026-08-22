export type Match = {
  id: string;
  name: string;
  initials: string;
  party: string;
  area: string;
  score: number;
  reason: string;
  color: string;
  website: string;
};

/** データソース接続前に API から返すデモ用の政治家マッチです。 */
export const politicianMatches: Match[] = [
  { id: "a", name: "水野 あかり", initials: "MA", party: "みらい市民党", area: "神奈川3区", score: 92, reason: "再生可能エネルギーへの投資と、地域住民が参加する合意形成を重視する点が一致しています。", color: "#d57a4a", website: "https://example.com/politicians/mizuno" },
  { id: "b", name: "藤原 健太", initials: "FK", party: "共創ネット", area: "東京11区", score: 86, reason: "エネルギー転換を成長戦略と捉え、送電網などの基盤整備を優先する姿勢が近いです。", color: "#527b6b", website: "https://example.com/politicians/fujiwara" },
  { id: "c", name: "野村 さつき", initials: "NS", party: "地域の風", area: "長野2区", score: 79, reason: "環境政策を進めながら、景観や地域経済への影響も慎重に評価する立場が共通しています。", color: "#68759c", website: "https://example.com/politicians/nomura" },
];
