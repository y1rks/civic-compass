import type { Article, Match, SavedInterest } from "./types";

// 未接続の関数を、画面上で非同期処理として扱うための遅延です。
const delay = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms));

type ArticlesResponse = {
  articles: Article[];
};

const politicians: Match[] = [
  { id: "a", name: "水野 あかり", initials: "MA", party: "みらい市民党", area: "神奈川3区", score: 92, reason: "再生可能エネルギーへの投資と、地域住民が参加する合意形成を重視する点が一致しています。", color: "#d57a4a", website: "https://example.com/politicians/mizuno" },
  { id: "b", name: "藤原 健太", initials: "FK", party: "共創ネット", area: "東京11区", score: 86, reason: "エネルギー転換を成長戦略と捉え、送電網などの基盤整備を優先する姿勢が近いです。", color: "#527b6b", website: "https://example.com/politicians/fujiwara" },
  { id: "c", name: "野村 さつき", initials: "NS", party: "地域の風", area: "長野2区", score: 79, reason: "環境政策を進めながら、景観や地域経済への影響も慎重に評価する立場が共通しています。", color: "#68759c", website: "https://example.com/politicians/nomura" },
];

export async function getArticles(): Promise<Article[]> {
  const response = await fetch("/api/articles", {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`記事の取得に失敗しました (${response.status})`);
  }

  const data = await response.json() as ArticlesResponse;
  return data.articles;
}
export async function saveInterest(articleId: string, comment: string): Promise<SavedInterest> {
  await delay(420);
  return { articleId, comment, interested: true, savedAt: new Date().toISOString() };
}
export async function getMatches(_articleId: string) { await delay(360); return politicians; }
export function getProfileMatches(articleIds: string[]) {
  const boost = Math.min(articleIds.length * 2, 5);
  return politicians.map((person, i) => ({ ...person, score: Math.min(98, person.score - 5 + boost - i) }));
}
