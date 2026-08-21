import type { Article, Match, SavedInterest } from "./types";

// API提供後はこのファイルの各関数だけを実通信へ差し替えます。
const delay = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms));

const articles: Article[] = [
  {
    id: "energy-2035", category: "環境・エネルギー", readTime: "4分で読める", source: "POLISCOPE NEWS", publishedAt: "2時間前",
    title: "再生可能エネルギー、2035年までに電源構成の50%へ——新目標案を発表",
    summary: "政府の有識者会議は、再生可能エネルギーの比率を大幅に引き上げる新たな目標案を公表しました。地域との合意形成や送電網整備が焦点です。",
    image: "https://images.unsplash.com/photo-1509391366360-2e959784a276?auto=format&fit=crop&w=1200&q=85",
    body: [
      "政府のエネルギー政策を検討する有識者会議は21日、2035年の電源構成に占める再生可能エネルギーの割合を50%程度まで引き上げる目標案を示しました。太陽光・風力の導入加速に加え、蓄電池と送電網への投資を一体で進める方針です。",
      "一方、発電設備の立地をめぐっては、景観や自然環境への影響を懸念する声もあります。案では、自治体や住民が計画の初期段階から参加する仕組みを設け、地域への利益還元を事業者に求めるとしています。",
      "今後は電気料金への影響や、天候に左右される電源を安定して運用するための費用負担が論点になります。政府は秋までに意見公募を行い、年内の計画決定を目指します。",
    ],
  },
  {
    id: "childcare", category: "子育て・教育", readTime: "3分で読める", source: "みらい通信", publishedAt: "4時間前",
    title: "給食費の無償化、全国で段階導入へ　自治体間の格差解消を目指す",
    summary: "公立小中学校の給食費を段階的に無償化する方針がまとまりました。財源の分担方法が今後の論点です。",
    image: "https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=900&q=85",
    body: ["公立小中学校の給食費について、国が費用の一部を負担し、全国で段階的に無償化する方針案が示されました。", "先行して無償化している自治体との公平性や、食材価格が上昇する中で給食の質をどう確保するかが課題になります。"],
  },
  {
    id: "mobility", category: "地域・交通", readTime: "5分で読める", source: "LOCAL POLICY", publishedAt: "6時間前",
    title: "地方の移動を支える『日本版ライドシェア』、対象地域を拡大へ",
    summary: "交通空白地帯への対応として、地域主体の移動サービスを拡大する案が検討されています。",
    image: "https://images.unsplash.com/photo-1554797589-7241bb691973?auto=format&fit=crop&w=900&q=85",
    body: ["公共交通の担い手不足が深刻な地域を対象に、日本版ライドシェアの運行エリアと時間帯を広げる案が公表されました。", "安全管理と運転手の待遇、既存のタクシー事業との共存が主要な論点です。"],
  },
  {
    id: "workweek", category: "働き方・経済", readTime: "4分で読める", source: "ECONOMY NOW", publishedAt: "昨日",
    title: "選択的週休3日制を導入する企業、2年で倍増　生産性への効果は",
    summary: "柔軟な働き方を導入する企業が増える一方、業種による導入格差も明らかになっています。",
    image: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=85",
    body: ["選択的週休3日制を導入した企業が、2年前と比べて約2倍になったことが民間調査で分かりました。", "人材採用での効果が報告される一方、現場業務のある職種では人員確保が壁になっています。"],
  },
  {
    id: "disaster", category: "防災・自治体", readTime: "3分で読める", source: "防災ジャーナル", publishedAt: "昨日",
    title: "避難所の環境基準を初めて全国統一へ　プライバシー確保も明記",
    summary: "災害時の避難所について、居住スペースや衛生設備の最低基準を国が示しました。",
    image: "https://images.unsplash.com/photo-1547683905-f686c993aae5?auto=format&fit=crop&w=900&q=85",
    body: ["国は避難所の生活環境を改善するため、1人あたりの居住面積やトイレの設置数に関する共通基準案をまとめました。", "自治体の財政負担をどう支えるか、平時から必要な備蓄をどう確保するかが検討されます。"],
  },
  {
    id: "digital", category: "デジタル行政", readTime: "6分で読める", source: "CIVIC TECH", publishedAt: "2日前",
    title: "行政手続きのオンライン化率9割へ　『書かない窓口』も拡大",
    summary: "国と自治体の申請データを連携し、同じ情報を繰り返し記入する負担を減らす計画です。",
    image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=900&q=85",
    body: ["行政手続きのオンライン完結率を高め、窓口でも申請書を書かずに済む仕組みを全国へ広げる工程表が示されました。", "利便性向上とともに、高齢者などデジタル機器に不慣れな人への支援が求められます。"],
  },
  {
    id: "housing", category: "住宅・暮らし", readTime: "4分で読める", source: "くらし政策部", publishedAt: "2日前",
    title: "空き家を子育て世帯向け住宅へ　改修支援の新制度を検討",
    summary: "増加する空き家と若年世帯の住宅負担を同時に解決する政策案が浮上しました。",
    image: "https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=900&q=85",
    body: ["自治体が認定した空き家を改修し、子育て世帯へ低廉な家賃で提供する新制度が検討されています。", "所有者不明物件の扱いや、改修後の管理主体をどうするかが課題です。"],
  },
  {
    id: "care", category: "医療・福祉", readTime: "5分で読める", source: "HEALTH POLICY", publishedAt: "3日前",
    title: "在宅介護を支える家族への現金給付、モデル事業を5都市で開始",
    summary: "介護離職を防ぐため、家族介護者への給付と相談支援を組み合わせる実証が始まります。",
    image: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=900&q=85",
    body: ["在宅で家族を介護する人を対象に、月額給付と相談支援を組み合わせたモデル事業が始まります。", "家族だけに負担を集中させない制度設計と、介護サービスの供給拡大も同時に必要だと指摘されています。"],
  },
];

const politicians: Match[] = [
  { id: "a", name: "水野 あかり", initials: "MA", party: "みらい市民党", area: "神奈川3区", score: 92, reason: "再生可能エネルギーへの投資と、地域住民が参加する合意形成を重視する点が一致しています。", color: "#d57a4a", website: "https://example.com/politicians/mizuno" },
  { id: "b", name: "藤原 健太", initials: "FK", party: "共創ネット", area: "東京11区", score: 86, reason: "エネルギー転換を成長戦略と捉え、送電網などの基盤整備を優先する姿勢が近いです。", color: "#527b6b", website: "https://example.com/politicians/fujiwara" },
  { id: "c", name: "野村 さつき", initials: "NS", party: "地域の風", area: "長野2区", score: 79, reason: "環境政策を進めながら、景観や地域経済への影響も慎重に評価する立場が共通しています。", color: "#68759c", website: "https://example.com/politicians/nomura" },
];

export async function getArticles() { await delay(); return articles; }
export async function saveInterest(articleId: string, comment: string): Promise<SavedInterest> {
  await delay(420);
  return { articleId, comment, interested: true, savedAt: new Date().toISOString() };
}
export async function getMatches(_articleId: string) { await delay(360); return politicians; }
export function getProfileMatches(articleIds: string[]) {
  const boost = Math.min(articleIds.length * 2, 5);
  return politicians.map((person, i) => ({ ...person, score: Math.min(98, person.score - 5 + boost - i) }));
}
