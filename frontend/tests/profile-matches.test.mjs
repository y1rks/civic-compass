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
const { ProfileMatches, withRank } = await import(outputUrl.href);
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
  assert.match(html, /78\.0<small>%/);
  assert.match(html, /被害や苦痛への配慮/);
  assert.match(html, /href="https:\/\/example.com\/politician"/);
});

const partyMatch = {
  party_id: "PT01",
  party: "自由民主党",
  short_name: "自民",
  website: "https://www.jimin.jp/",
  seats: { shugiin: 316, sangiin: 101 },
  color: "#3CA324",
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

// 上位3件だけ出し、残りは「もっと見る」で開きます（初期表示は畳んだ状態）。
test("4件目以降は畳み、もっと見るボタンで開けるようにする", () => {
  const many = Array.from({ length: 7 }, (_, index) => ({
    ...result.matches[0],
    speaker_id: `P0000${index + 1}`,
    politician_name: `議員${index + 1}`,
    match_score: 70 - index,
  }));
  const html = render({ result: { ...result, matches: many } });

  assert.match(html, /議員3/);
  assert.doesNotMatch(html, /議員4/);
  assert.match(html, /class="match-more"[^>]*aria-expanded="false"/);
  assert.match(html, />もっと見る</);
});

test("3件以下なら「もっと見る」を出さない", () => {
  assert.doesNotMatch(render(), /match-more/);
});

// 同率は同じ順位にし、次の順位はその件数ぶん飛ばします（1, 2, 2, 4）。
test("マッチ度が同率なら同じ順位を出す", () => {
  const scores = [70, 33, 33, 30];
  const tied = scores.map((score, index) => ({
    ...result.matches[0],
    speaker_id: `P0000${index + 1}`,
    politician_name: `議員${index + 1}`,
    match_score: score,
  }));
  const html = render({ result: { ...result, matches: tied } });
  const ranks = [...html.matchAll(/class="profile-rank">(\d+)</g)].map(([, rank]) => rank);

  // 畳んでいるので3件目まで。4件目が「4位」になることは下の withRank のテストで見ます。
  assert.deepEqual(ranks, ["1", "2", "2"]);
});

test("同率のあとの順位はその件数ぶん飛ばす", () => {
  const ranks = (scores) => withRank(scores.map((match_score) => ({ match_score }))).map(({ rank }) => rank);

  assert.deepEqual(ranks([70, 33, 33, 30]), [1, 2, 2, 4]);
  assert.deepEqual(ranks([50, 40, 40, 40, 10]), [1, 2, 2, 2, 5]);
  assert.deepEqual(ranks([33, 33, 33]), [1, 1, 1]);
  assert.deepEqual(ranks([]), []);
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
