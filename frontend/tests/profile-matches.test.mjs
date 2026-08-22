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

const partyMatch = {
  party_id: "PT01",
  party: "自由民主党",
  short_name: "自民",
  website: "https://www.jimin.jp/",
  seats: { shugiin: 316, sangiin: 101 },
  source: "mixed",
  match_score: 62,
  matched_cells: 2,
  n_politicians: 3,
  reasons: [],
  differences: [],
};

test("政治家と政党をタブで切り替えられる", () => {
  const html = render({ result: { ...result, party_matches: [partyMatch] } });

  assert.match(html, /role="tab"[^>]*>政治家</);
  assert.match(html, /role="tab"[^>]*>政党</);
  // 初期表示は政治家タブ。政党カードは切り替えるまで描画しません。
  assert.match(html, /aria-selected="true"[^>]*>政治家</);
  assert.doesNotMatch(html, /自由民主党・衆議院[\s\S]*自民</);
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
