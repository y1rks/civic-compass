// 「分析の深さ」の算出。進捗バーではなく、マッチが安定して出せる状態かを測ります。
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, rm } from "node:fs/promises";
import { transform } from "esbuild";

const compiled = new URL("./analysis-depth.compiled.mjs", import.meta.url);
const source = await readFile(new URL("../lib/analysis-depth.ts", import.meta.url), "utf8");
const { code } = await transform(source, { loader: "ts", format: "esm" });
await writeFile(compiled, code);
const { analysisDepth, SUFFICIENT_ANSWERS } = await import(compiled.href);
test.after(() => rm(compiled, { force: true }));

/** 記事1本 = 設問2問。frame は連番で振り分ける */
const article = (id, frames) => ({
  id, category: "", title: "", summary: "", body: [], image: "", source: "", publishedAt: "",
  questions: frames.map((frame, i) => ({ id: `${id}_q${i}`, prompt: "", frame, target: "国民全体", role: "beneficiary", options: [] })),
});
const answer = (article, count = article.questions.length) => ({
  articleId: article.id, interest: 1, comment: "", savedAt: "",
  selections: Object.fromEntries(article.questions.slice(0, count).map((q) => [q.id, "uphold"])),
});
const saved = (...answers) => Object.fromEntries(answers.map((a) => [a.articleId, a]));

test("記事が読み込めていなければ0", () => {
  assert.equal(analysisDepth([], {}), 0);
});

test("何も答えていなければ0", () => {
  assert.equal(analysisDepth([article("a", ["care_harm", "fairness"])], {}), 0);
});

test("出題が目標に満たないうちは、全問答えれば100になる", () => {
  // 記事8本16問（目標36問より少ない）。全問答えたら頭打ちにしない
  const articles = Array.from({ length: 8 }, (_, i) => article(`a${i}`, ["care_harm", "fairness"]));
  assert.equal(analysisDepth(articles, saved(...articles.map((a) => answer(a)))), 100);
});

test("★出題が増えても、必要十分な回答数で100に届く（全記事数を分母にしない）", () => {
  // 記事1000本2000問。ここで全問要求すると、記事が増えるほど数字が上がらなくなる
  const articles = Array.from({ length: 1000 }, (_, i) => article(`a${i}`, ["care_harm", "fairness"]));
  const enough = articles.slice(0, SUFFICIENT_ANSWERS / 2);
  assert.equal(analysisDepth(articles, saved(...enough.map((a) => answer(a)))), 100);
});

test("同じ観点ばかり答えると伸びない（量と幅の両方を見る）", () => {
  const frames = ["care_harm", "fairness", "liberty_autonomy", "authority_order"];
  const articles = frames.map((frame, i) => article(`a${i}`, [frame, frame]));
  const narrow = analysisDepth(articles, saved(answer(articles[0]), answer(articles[1])));
  const wide = analysisDepth(articles, saved(answer(articles[0]), answer(articles[2]), answer(articles[3])));
  assert.ok(narrow < wide, `幅が反映されていない: ${narrow} / ${wide}`);

  // 同じ2記事でも、観点が1種類だけなら幅のぶんが入らない
  const same = [article("x", ["care_harm", "care_harm"]), article("y", ["care_harm", "care_harm"])];
  assert.ok(analysisDepth(same, saved(answer(same[0]))) < 100);
});

test("保存済みでも、いま出題されていない記事の回答は数えない", () => {
  const shown = article("a", ["care_harm", "fairness"]);
  const gone = article("old", ["sovereignty", "evidence_expertise"]);
  assert.equal(analysisDepth([shown], saved(answer(shown), answer(gone))), 100);
});
