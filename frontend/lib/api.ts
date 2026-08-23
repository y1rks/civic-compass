import type {
  Article, CurrentUser, Match, PerspectiveResult, ProfileMatchesResponse, SavedAnswer, UserProfileCell,
} from "./types";

type ArticlesResponse = {
  articles: Article[];
};

type AnswersResponse = {
  answers: SavedAnswer[];
};

type AnswerResponse = {
  answer: SavedAnswer;
};

type ArticleMatchesResponse = {
  matches: Match[];
};

type UserProfileResponse = {
  cells: UserProfileCell[];
};

type CurrentUserResponse = {
  user: CurrentUser;
};

type SessionResponse = {
  user: CurrentUser | null;
};

async function requestJson<T>(path: string, init: RequestInit | undefined, errorMessage: string): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
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

/** Cookieに対応するユーザーを確認します。初回利用時は null です。 */
export async function getSession(): Promise<CurrentUser | null> {
  const data = await requestJson<SessionResponse>("/api/session", undefined, "利用情報の確認に失敗しました");
  return data.user;
}

/** 初回入力の名前でユーザーを作成し、Cookieセッションを開始します。 */
export async function createSession(name: string): Promise<CurrentUser> {
  const data = await requestJson<CurrentUserResponse>("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  }, "ユーザーの作成に失敗しました");
  return data.user;
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

/** いまログインしているユーザーの表示用情報。ユーザーの特定はサーバー側で行います。 */
export async function getCurrentUser(): Promise<CurrentUser> {
  const data = await requestJson<CurrentUserResponse>("/api/user", undefined, "ユーザー情報の取得に失敗しました");
  return data.user;
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

/** 記事単位のデモ用マッチ。B に置き換わりましたが、API は残っています。 */
export async function getMatches(articleId: string): Promise<Match[]> {
  const data = await requestJson<ArticleMatchesResponse>(
    `/api/matches/${encodeURIComponent(articleId)}`,
    undefined,
    "政治家マッチの取得に失敗しました",
  );
  return data.matches;
}

export async function getProfileMatches(): Promise<ProfileMatchesResponse> {
  return requestJson<ProfileMatchesResponse>(
    "/api/matches/profile",
    undefined,
    "総合マッチの取得に失敗しました",
  );
}

export async function getUserProfileCells(): Promise<UserProfileCell[]> {
  const data = await requestJson<UserProfileResponse>(
    "/api/user-profile",
    undefined,
    "考え方の傾向の取得に失敗しました",
  );
  return data.cells;
}
