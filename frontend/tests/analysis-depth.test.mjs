// 「分析の深さ」の算出。進捗バーではなく、マッチが安定して出せる状態かを測ります。
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, rm } from "node:fs/promises";
import { transform } from "esbuild";
import { FRAMES } from "@civic-compass/shared";

const compiled = new URL("./analysis-depth.compiled.mjs", import.meta.url);
const source = await readFile(new URL("../lib/analysis-depth.ts", import.meta.url), "utf8");
const { code } = await transform(source, { loader: "ts", format: "esm" });
await writeFile(compiled, code);
const { analysisDepth, DEPTH_TAU } = await import(compiled.href);
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

test("★100 には到達しない（答えるほど上がり続けるため漸近させる）", () => {
  // 10観点すべてに触れ、200問答えても 100 未満であること
  const articles = FRAMES.map((frame, i) => article(`a${i}`, Array.from({ length: 20 }, () => frame)));
  const depth = analysisDepth(articles, saved(...articles.map((a) => answer(a))));
  assert.ok(depth > 90, `伸びなさすぎ: ${depth}`);
  assert.ok(depth < 100, `100 に到達している: ${depth}`);
});

test("★同じ回答数なら、記事が何本あっても同じ値になる（全記事数を分母にしない）", () => {
  // 記事が増えるほど数字が上がらなくなる、という壊れ方の検出
  const build = (count) => Array.from({ length: count }, (_, i) => article(`a${i}`, ["care_harm", "fairness"]));
  const small = build(10);
  const huge = build(1000);
  const answers = (list) => saved(...list.slice(0, 8).map((a) => answer(a)));   // どちらも16問

  assert.equal(analysisDepth(small, answers(small)), analysisDepth(huge, answers(huge)));
});

test("出題の少なさがそのまま上限になる", () => {
  // いまの設問カタログは 8記事15問・8観点。全部答えても上限は 57%
  const frames = ["care_harm", "efficiency_utility", "fairness", "authority_order",
    "liberty_autonomy", "sanctity_tradition", "procedure_rule_of_law", "loyalty_community"];
  const articles = [
    article("a0", [frames[0], frames[1]]), article("a1", [frames[0], frames[2]]),
    article("a2", [frames[3], frames[2]]), article("a3", [frames[4]]),
    article("a4", [frames[5], frames[0]]), article("a5", [frames[0], frames[6]]),
    article("a6", [frames[3], frames[7]]), article("a7", [frames[7], frames[2]]),
  ];
  assert.equal(analysisDepth(articles, saved(...articles.map((a) => answer(a)))), 56);
});

test("保存済みでも、いま出題されていない記事の回答は数えない", () => {
  const shown = article("a", ["care_harm", "fairness"]);
  const gone = article("old", ["sovereignty", "evidence_expertise"]);
  assert.equal(
    analysisDepth([shown], saved(answer(shown), answer(gone))),
    analysisDepth([shown], saved(answer(shown))),
  );
});
