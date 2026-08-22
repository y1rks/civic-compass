import assert from "node:assert/strict";
import test from "node:test";

const {
  calculateProfileMatch,
  makeUserSummary,
} = await import("../src/profile-match.ts");

const cells = [
  { frame: "care_harm", target: "自然環境", role: "beneficiary", score: 1, share: 0.5, n: 1 },
  { frame: "fairness", target: "地方", role: "beneficiary", score: 1, share: 0.3, n: 1 },
  { frame: "sovereignty", target: "国民全体", role: "beneficiary", score: -1, share: 0.2, n: 1 },
];

const user = (overrides = {}) => ({
  user_id: "test_user1",
  computed_at: "2026-08-22T00:00:00.000Z",
  profile_version: "user-profile-v1.0",
  n_answers: 5,
  n_selections: 5,
  cells,
  declined_cells: [],
  override_rate: 0.066,
  override_weight: 3.718,
  ...overrides,
});

const politicianCell = (cell, overrides = {}) => ({
  ...cell,
  n: 3,
  distinctiveness: 1,
  ...overrides,
});

test("セルキーはframe・target・roleの完全一致で比較する", () => {
  const profile = {
    cells: [
      politicianCell(cells[0]),
      politicianCell(cells[1], { role: "threat" }),
    ],
  };
  const result = calculateProfileMatch(user(), profile, new Set());

  assert.equal(result.reliable, false);
  assert.equal(result.matched_cells, 1);
});

test("議員にないユーザーセルも分母に残る", () => {
  const partial = calculateProfileMatch(user(), {
    cells: cells.slice(0, 2).map((cell) => politicianCell(cell)),
  }, new Set());
  const full = calculateProfileMatch(user(), {
    cells: cells.map((cell) => politicianCell(cell)),
  }, new Set());

  assert.equal(partial.reliable, true);
  assert.equal(full.reliable, true);
  assert.ok(full.match_score > partial.match_score);
});

test("議員側だけnが3未満のセルを除外する", () => {
  const result = calculateProfileMatch(user(), {
    cells: [politicianCell(cells[0], { n: 2 }), politicianCell(cells[1])],
  }, new Set());

  assert.equal(result.reliable, false);
  assert.equal(result.matched_cells, 1);
});

test("declinedセルをsilentでも二重加点せず、スコアを0〜100に収める", () => {
  const declined = { frame: "evidence_expertise", target: "国際社会", role: "threat" };
  const active = cells.slice(0, 2).map((cell) => ({ ...cell, share: 0.5 }));
  const result = calculateProfileMatch(user({ cells: active, declined_cells: [declined] }), {
    cells: active.map((cell) => politicianCell(cell, { share: 0.01 })),
  }, new Set(["evidence_expertise|国際社会|threat"]));

  assert.equal(result.reliable, true);
  assert.equal(result.match_score, 60);
  assert.ok(result.match_score <= 100);
});

test("理由・相違点・ユーザー要約をテンプレートで作る", () => {
  const result = calculateProfileMatch(user(), {
    cells: [
      politicianCell(cells[0], { score: -1 }),
      politicianCell(cells[1]),
      politicianCell(cells[2], { score: 1 }),
    ],
  }, new Set());

  assert.match(makeUserSummary(user()), /自然環境について、被害や苦痛への配慮を重んじる/);
  assert.ok(result.reasons.every((reason) => !/保守|リベラル|左派|右派/.test(reason.text)));
  assert.equal(result.differences.length, 2);
  assert.match(result.differences[0].text, /一方/);
});
