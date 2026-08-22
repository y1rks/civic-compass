import { FRAMES } from "@civic-compass/shared";
import type { Article, SavedAnswer } from "./types";

/**
 * 「分析の深さ」の算出。
 *
 * 測っているのは**マッチの結果がどれだけ確からしいか**です。進捗バーではないので、
 * 分母に「全記事数」を使いません。記事が1000件になったとき、全部答えないと数字が
 * 上がらなくなってしまうためです。回答の**絶対数**から出します。
 */

/**
 * 回答数に対する確からしさの時定数。**実測に合わせた値**。
 *
 * 議員15人のプロファイルを「思想が固まった1人のユーザー」に見立て、その人のセルから
 * k 個だけ抜き出して回答したことにし、**その議員自身が1位に出る割合**を測った
 * （12ペルソナ × 各25サンプル）。
 *
 *   回答数  実測    1-exp(-k/28)
 *       12   31%           35%
 *       20   49%           51%
 *       30   73%           66%
 *       40   80%           76%
 *       50   91%           83%
 *       70  100%           92%
 *
 * ★頭打ちにならない。答えるほど上がり続けるので、**どこかで 100% にする式にしない**。
 *   指数で 100% に漸近させ、高い値ほど実測より控えめに出るようにしてある。
 */
export const DEPTH_TAU = 28;

/** 量（どれだけ答えたか）と幅（いくつの観点に触れたか）の配分。 */
const ANSWER_WEIGHT = 0.6;
const FRAME_WEIGHT = 0.4;

/**
 * 0〜99 の整数。**100 には到達しません**（回答の項が漸近するため。切り捨てで丸める）。
 *
 * ★フレームの分母は語彙の全10種。**出題に登場する種類ではありません**。
 *   いまの設問カタログには `sovereignty` と `evidence_expertise` の設問が無いので、
 *   全記事に答えても 8/10 で止まります。これは正しい挙動で、**記事の少なさが
 *   そのまま分析の浅さ**だからです（現行カタログ 8記事15問での上限は 57%）。
 */
export function analysisDepth(articles: Article[], saved: Record<string, SavedAnswer>): number {
  const questions = articles.flatMap((article) => article.questions);
  if (questions.length === 0) return 0;

  const answeredIds = new Set(Object.values(saved).flatMap((answer) => Object.keys(answer.selections)));
  const answered = questions.filter((question) => answeredIds.has(question.id));

  const answerDepth = 1 - Math.exp(-answered.length / DEPTH_TAU);
  const frameDepth = new Set(answered.map((question) => question.frame)).size / FRAMES.length;

  // 切り上げないのは、漸近しているだけの 99.9 を 100 と表示しないため
  return Math.floor(100 * (ANSWER_WEIGHT * answerDepth + FRAME_WEIGHT * frameDepth));
}
