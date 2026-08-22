import type { Article, Match, PerspectiveResult, SavedAnswer } from "./types";

type ArticlesResponse = {
  articles: Article[];
};

type AnswersResponse = {
  answers: SavedAnswer[];
};

type AnswerResponse = {
  answer: SavedAnswer;
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

/**
 * いまログインしているユーザーの回答一覧。
 * ユーザーの特定はサーバー側で完結しているので、ここでは何も送りません。
 */
export async function getAnswers(): Promise<SavedAnswer[]> {
  const data = await requestJson<AnswersResponse>("/api/answers", undefined, "保存済みの意見の取得に失敗しました");
  return data.answers;
}

export async function saveAnswer(input: {
  articleId: string;
  interest: number;
  comment: string;
  selections: SavedAnswer["selections"];
}): Promise<SavedAnswer> {
  const data = await requestJson<AnswerResponse>("/api/answers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }, "意見の保存に失敗しました");
  return data.answer;
}

/**
 * B（意見保存直後のポップアップ）。直前に保存した意見の論点ごとに、
 * 議員が国会でどう語ってきたかを返します。
 *
 * 取得できるのは保存済みの記事だけなので、保存の直後に呼びます。
 */
export async function getPerspectives(articleId: string): Promise<PerspectiveResult> {
  return await requestJson<PerspectiveResult>(
    `/api/perspectives/${encodeURIComponent(articleId)}`,
    undefined,
    "議員の発言の取得に失敗しました",
  );
}

export async function getProfileMatches(articleIds: string[]): Promise<Match[]> {
  const data = await requestJson<MatchesResponse>("/api/matches/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ articleIds }),
  }, "総合マッチの取得に失敗しました");
  return data.matches;
}
