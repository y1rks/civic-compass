import assert from "node:assert/strict";
import test from "node:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transform } from "esbuild";

const sourceUrl = new URL("../app/profile-matches.tsx", import.meta.url);
const outputUrl = new URL("../app/profile-matches.compiled.mjs", import.meta.url);
const { code } = await transform(await readFile(sourceUrl, "utf8"), {
  loader: "tsx",
  format: "esm",
  jsx: "automatic",
});
await writeFile(outputUrl, code);
const { ProfileMatches } = await import(outputUrl.href);
test.after(() => rm(outputUrl, { force: true }));

const result = {
  user_id: "test_user1",
  reliable: true,
  user_summary: "自然環境について、被害や苦痛への配慮を重んじる傾向があります。",
  matches: [{
    speaker_id: "P00001",
    politician_name: "高市早苗",
    party: "自由民主党",
    house: "衆議院",
    website: "https://example.com/politician",
    match_score: 78,
    matched_cells: 3,
    reasons: [],
    differences: [],
    evidence: [],
  }],
  party_matches: [],
  disclaimer: "これは参考情報です。",
};

const render = (props = {}) => renderToStaticMarkup(createElement(ProfileMatches, {
  savedCount: 5,
  result,
  status: "ready",
  ...props,
}));

test("総合マッチAPIの議員名・所属・マッチ度を表示する", () => {
  const html = render();
  assert.match(html, /高市早苗/);
  assert.match(html, /自由民主党・衆議院/);
  assert.match(html, /78<small>%/);
  assert.match(html, /被害や苦痛への配慮/);
  assert.match(html, /href="https:\/\/example.com\/politician"/);
});

test("信頼性不足なら追加回答を促す", () => {
  const html = render({ result: { ...result, reliable: false, matches: [], user_summary: "もう少し回答してください。" } });
  assert.match(html, /もう少し回答が必要です/);
  assert.match(html, /もう少し回答してください/);
  assert.doesNotMatch(html, /高市早苗/);
});

test("取得失敗を画面内に表示する", () => {
  assert.match(render({ status: "error" }), /マッチ結果を読み込めませんでした/);
});
