export type Article = {
  id: string;
  category: string;
  title: string;
  summary: string;
  body: string[];
  image: string;
  source: string;
  publishedAt: string;
};

export type SavedInterest = {
  articleId: string;
  comment: string;
  interested: true;
  savedAt: string;
};

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
