import type { Article, SavedAnswer } from "./types";

/**
 * 「分析の深さ」の算出。
 *
 * 測っているのは**マッチの結果がどれだけ安定して出せる状態か**です。
 * 進捗バーではないので、記事が増えても目標が青天井にはなりません。
 */

/**
 * これ以上答えても結果がほぼ変わらない回答数。**実測値**。
 *
 * 議員15人のプロファイルを「思想が固まった1人のユーザー」に見立て、その人の全セル
 * （55〜84種）から k 個だけを抜き出して回答したことにし、全部答えたときの順位と
 * どれだけ一致するかを測った（12ペルソナ × 各20サンプル）。
 *
 *   セル数 15 → 1位一致 36%   （現行の設問カタログの上限）
 *          24 → 57%
 *          36 → 78%
 *          40 → 85%
 *          45 → 81%    ← ここから伸びない
 *          50 → 84%
 *
 * 1問あたりの改善は 15→24問で 2.3pt、24→36問で 1.75pt、36→50問で 0.4pt と
 * 4分の1以下に落ちる。36問（≒20記事）を必要十分とみなす。
 */
export const SUFFICIENT_ANSWERS = 36;

/** 量（どれだけ答えたか）と幅（いくつの観点に触れたか）の配分。 */
const ANSWER_WEIGHT = 0.6;
const FRAME_WEIGHT = 0.4;

/**
 * 0〜100 の整数。
 *
 * ★分母に「全記事数」を使わないこと。記事が1000件になったとき、全部答えないと
 *   数字が上がらなくなる。目標は `SUFFICIENT_ANSWERS` で頭打ちにする。
 *
 * ★ただし出題数がそれに満たないうちは、出題数のほうを目標にする。そうしないと
 *   記事が8本しかない状態では、全問答えても 42% までしか届かない。
 *   フレームの分母も同じ理由で、10種ではなく**出題に登場する種類**にする
 *   （`sovereignty` と `evidence_expertise` の設問はまだ存在しない）。
 */
export function analysisDepth(articles: Article[], saved: Record<string, SavedAnswer>): number {
  const questions = articles.flatMap((article) => article.questions);
  if (questions.length === 0) return 0;

  const answeredIds = new Set(Object.values(saved).flatMap((answer) => Object.keys(answer.selections)));
  const answered = questions.filter((question) => answeredIds.has(question.id));

  const answerRate = Math.min(1, answered.length / Math.min(SUFFICIENT_ANSWERS, questions.length));
  const askedFrames = new Set(questions.map((question) => question.frame));
  const frameCoverage = new Set(answered.map((question) => question.frame)).size / askedFrames.size;

  return Math.round(100 * (ANSWER_WEIGHT * answerRate + FRAME_WEIGHT * frameCoverage));
}
