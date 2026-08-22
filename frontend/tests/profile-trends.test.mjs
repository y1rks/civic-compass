import assert from "node:assert/strict";
import test from "node:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transform } from "esbuild";

const sourceUrl = new URL("../app/profile-trends.tsx", import.meta.url);
const outputUrl = new URL("../app/profile-trends.compiled.mjs", import.meta.url);
const { code } = await transform(await readFile(sourceUrl, "utf8"), {
  loader: "tsx",
  format: "esm",
  jsx: "automatic",
});
await writeFile(outputUrl, code);
const { ProfileTrends } = await import(outputUrl.href);
test.after(() => rm(outputUrl, { force: true }));

const cells = [
  { frame: "care_harm", target: "子ども・将来世代", role: "beneficiary", score: 1, share: 0.5, n: 1 },
  { frame: "fairness", target: "地方", role: "threat", score: 0.75, share: 0.3, n: 1 },
];

const render = (props = {}) => renderToStaticMarkup(createElement(ProfileTrends, {
  cells,
  status: "ready",
  ...props,
}));

test("上位セルの組み合わせと傾向を日本語で表示する", () => {
  const html = render();
  assert.match(html, /被害や苦痛への配慮/);
  assert.match(html, /子ども・将来世代/);
  assert.match(html, /「被害や苦痛への配慮」の観点/);
  assert.match(html, /class="trend-stance beneficiary">子ども・将来世代を守る立場</);
  assert.match(html, /「子ども・将来世代にとって苦痛や被害が生じないか」を重視/);
  assert.match(html, /公正さ/);
  assert.match(html, /class="trend-stance threat">地方を問題視する立場</);
  assert.match(html, /「地方が負担や取り分の偏りを生まないか」を重視/);
  assert.doesNotMatch(html, /[+-]\d\.\d{2}/);
  assert.doesNotMatch(html, /trend-score-chart|trend-chart-fill|この価値を重視/);
  assert.match(html, /回答の結果、以下の価値観を強く優先する傾向にあります。/);
  // 内部の分類名をそのまま出さない（読み手に意味が伝わらないため）
  assert.doesNotMatch(html, /守る対象・利益を及ぼす対象|脅威・問題の原因/);
});

test("★score が 0 以下のセルは表示しない（「重視」と逆の意味になるため）", () => {
  const base = { frame: "liberty_autonomy", target: "個人", role: "beneficiary", share: .3, n: 3 };
  // API 側でも絞っているが、表示する場所でも保証する
  const html = render({ cells: [{ ...base, score: -1 }, { ...base, target: "地方", score: 0 }] });

  assert.doesNotMatch(html, /trend-card/);
  assert.match(html, /ニュースに意見を保存していくと/);
});

test("正のセルだけが残る（混在していても取りこぼさない）", () => {
  const base = { frame: "liberty_autonomy", target: "個人", role: "beneficiary", share: .3, n: 3 };
  const html = render({ cells: [{ ...base, score: -1 }, { ...base, target: "地方", score: 1 }] });

  assert.match(html, /class="trend-stance beneficiary">地方を守る立場</);
  assert.doesNotMatch(html, /個人を守る立場/);
});

test("role で物差しの言い方が変わる（守る立場と問題視する立場は正反対のため）", () => {
  const html = render({
    cells: [
      { frame: "sovereignty", target: "外国人・移民", role: "threat", score: 1, share: .3, n: 3 },
      { frame: "sovereignty", target: "外国人・移民", role: "beneficiary", score: 1, share: .2, n: 3 },
    ],
  });
  assert.match(html, /「外国人・移民が自分たちで決められる余地を狭めないか」を重視/);
  assert.match(html, /「外国人・移民にとって自分たちで決められる余地が保たれるか」を重視/);
});

test("その考え方をとる人の言い分の例を2つ出す", () => {
  const html = render({
    cells: [{ frame: "liberty_autonomy", target: "個人", role: "beneficiary", score: 1, share: .3, n: 3 }],
  });
  // かぎ括弧では囲まない。「例」ラベルと箇条書きで例だと示す
  assert.match(html, /trend-examples-label">例</);
  assert.match(html, /<li>決めるのは個人自身で、上から一律に押し付けるものではない<\/li>/);
  assert.match(html, /<li>選ばない自由も含めて、個人に選択肢を残しておくべきだ<\/li>/);
});

test("セルがなければ回答を促す", () => {
  const html = render({ cells: [] });
  assert.match(html, /ニュースに意見を保存していくと/);
  // 0件のときに「以下の価値観を…」と出すと、続く文言と矛盾する
  assert.doesNotMatch(html, /以下の価値観を強く優先する傾向にあります/);
});

test("取得失敗時は画面内にエラーを表示する", () => {
  const html = render({ status: "error" });
  assert.match(html, /考え方の傾向を読み込めませんでした/);
});
