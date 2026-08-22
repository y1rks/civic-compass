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
  { frame: "care_harm", target: "子ども・将来世代", role: "beneficiary", score: -1, share: 0.5, n: 1 },
  { frame: "fairness", target: "地方", role: "threat", score: 0.75, share: 0.3, n: 1 },
];

const render = (props = {}) => renderToStaticMarkup(createElement(ProfileTrends, {
  cells,
  status: "ready",
  ...props,
}));

test("上位セルの組み合わせと正負のスコアを日本語で表示する", () => {
  const html = render();
  assert.match(html, /被害や苦痛への配慮/);
  assert.match(html, /子ども・将来世代/);
  assert.match(html, /守る対象・利益を及ぼす対象/);
  assert.match(html, /-1\.00/);
  assert.match(html, /公正さ/);
  assert.match(html, /脅威・問題の原因/);
  assert.match(html, /\+0\.75/);
  assert.match(html, /政策への賛否ではなく/);
});

test("セルがなければ回答を促す", () => {
  const html = render({ cells: [] });
  assert.match(html, /ニュースへの考えを保存すると/);
});

test("取得失敗時は画面内にエラーを表示する", () => {
  const html = render({ status: "error" });
  assert.match(html, /考え方の傾向を読み込めませんでした/);
});
