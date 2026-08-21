import type { Article, Match, SavedInterest } from "./types";

type ArticlesResponse = {
  articles: Article[];
};

type InterestResponse = {
  interest: SavedInterest;
};

type MatchesResponse = {
  matches: Match[];
};

async function requestJson<T>(path: string, init: RequestInit | undefined, errorMessage: string): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`${errorMessage} (${response.status})`);
  }

  return await response.json() as T;
}

export async function getArticles(): Promise<Article[]> {
  const data = await requestJson<ArticlesResponse>("/api/articles", undefined, "記事の取得に失敗しました");
  return data.articles;
}

export async function saveInterest(articleId: string, comment: string): Promise<SavedInterest> {
  const data = await requestJson<InterestResponse>("/api/interests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ articleId, comment }),
  }, "関心情報の保存に失敗しました");
  return data.interest;
}

export async function getMatches(articleId: string): Promise<Match[]> {
  const data = await requestJson<MatchesResponse>(
    `/api/matches/${encodeURIComponent(articleId)}`,
    undefined,
    "政治家マッチの取得に失敗しました",
  );
  return data.matches;
}

export async function getProfileMatches(articleIds: string[]): Promise<Match[]> {
  const data = await requestJson<MatchesResponse>("/api/matches/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ articleIds }),
  }, "総合マッチの取得に失敗しました");
  return data.matches;
}
