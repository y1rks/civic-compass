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

// ★未観測セルを分母から外してはいけません。外すとセルの少ない相手が誰にとっても
//   1位になります（自己再現テストで1位的中 6/15 → 4/15、安野貴博が15人中8人で1位）。
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
  // 未観測セルは一致としても数えません。
  assert.equal(partial.matched_cells, 2);
});

test("議員側だけnが3未満のセルを除外する", () => {
  const result = calculateProfileMatch(user(), {
    cells: [politicianCell(cells[0], { n: 2 }), politicianCell(cells[1])],
  }, new Set());

  assert.equal(result.reliable, false);
  assert.equal(result.matched_cells, 1);
});

// 相手が一度も語っていないセルは「優先順位を下げた」とみなし、
// ユーザーが下げたセル（score が負）とだけ一致させます。
test("語っていないセルは、ユーザーが優先順位を下げたセルとだけ一致する", () => {
  // cells[2] は sovereignty × 国民全体 でユーザーの score が -1。
  const withAbsence = calculateProfileMatch(user(), {
    cells: cells.slice(0, 2).map((cell) => politicianCell(cell)),
    source: "manifesto",
  }, new Set());
  // 同じ2セルしか語っていないが、ユーザー側も cells[2] を重んじている場合。
  const upheld = calculateProfileMatch(user({
    cells: cells.map((cell) => (cell === cells[2] ? { ...cell, score: 1 } : cell)),
  }), {
    cells: cells.slice(0, 2).map((cell) => politicianCell(cell)),
    source: "manifesto",
  }, new Set());

  assert.ok(withAbsence.match_score > upheld.match_score);
  // 加点は share × ABSENCE_WEIGHT ぶん（0.2 × 0.3 ÷ 分母1.0 = 6.0pt）。
  assert.equal(Math.round((withAbsence.match_score - upheld.match_score) * 10) / 10, 6);
});

test("観測量の少ない相手ほど、語っていないことを弱く扱う", () => {
  // cells[2] はユーザーが優先順位を下げたセル（score -1）。相手はそれを語っていない。
  const absent = (overrides) => calculateProfileMatch(user(), {
    cells: cells.slice(0, 2).map((cell) => politicianCell(cell, { n: overrides.n })),
    ...(overrides.source ? { source: overrides.source } : {}),
  }, new Set());

  const thin = absent({ n: 3 });
  const thick = absent({ n: 600 });

  // 観測が多いほど「語っていない＝優先順位を下げた」を信用して加点する。
  assert.ok(thick.match_score > thin.match_score);
  // 公約は網羅的なので、量に関わらず満額で扱う（＝観測の多い相手と同じ扱い）。
  assert.equal(absent({ n: 3, source: "manifesto" }).match_score, thick.match_score);
});

test("語っていないセルはreasons・differencesに出さない", () => {
  const result = calculateProfileMatch(user(), {
    cells: cells.slice(0, 2).map((cell) => politicianCell(cell)),
    source: "manifesto",
  }, new Set());
  const shown = [...result.reasons, ...result.differences].map((row) => `${row.frame}|${row.target}|${row.role}`);

  // 観測された発言ではないので、「この議員は◯◯を優先していない」と見せない。
  assert.ok(!shown.includes("sovereignty|国民全体|beneficiary"));
});

// 同じ frame × target を逆の role で語るのは思想の対立なので減点します。
// （「外国人・移民を守る対象として語る」vs「脅威として名指す」）
test("逆のroleで強く語っている相手を減点し、differencesに出す", () => {
  const cell = cells[0];   // care_harm × 自然環境 × beneficiary、ユーザーの score は +1
  const opposite = { ...cell, role: "threat" };
  // 沈黙の信用度は Σn で決まるので、逆ロールの有無だけを比べられるよう source を固定します。
  const withOpposite = calculateProfileMatch(user(), {
    cells: [politicianCell(cells[1]), politicianCell(cells[2]), politicianCell(opposite, { share: 0.4 })],
    source: "manifesto",
  }, new Set());
  const without = calculateProfileMatch(user(), {
    cells: [politicianCell(cells[1]), politicianCell(cells[2])],
    source: "manifesto",
  }, new Set());

  assert.ok(withOpposite.match_score < without.match_score);
  const shown = withOpposite.differences[0];
  assert.equal(shown.frame, cell.frame);
  assert.equal(shown.target, cell.target);
  // 主語はユーザーのセル。相手がどちら側で語ったかは文面が担う。
  assert.equal(shown.role, "beneficiary");
  assert.match(shown.text, /守る対象として語り、この相手は問題視する対象として語っています/);
});

test("逆のroleでも、その枠組みを退けている相手は減点しない", () => {
  const opposite = { ...cells[0], role: "threat" };
  // score -1 は「脅威という見方を持ち出したうえで退けた」。対立ではない。
  const rejected = calculateProfileMatch(user(), {
    cells: [politicianCell(cells[1]), politicianCell(cells[2]), politicianCell(opposite, { share: 0.4, score: -1 })],
    source: "manifesto",
  }, new Set());
  const without = calculateProfileMatch(user(), {
    cells: [politicianCell(cells[1]), politicianCell(cells[2])],
    source: "manifesto",
  }, new Set());

  assert.equal(rejected.match_score, without.match_score);
  assert.deepEqual(rejected.differences, without.differences);
});

test("ユーザー側が強く語っていないセルでは、逆roleを減点しない", () => {
  const opposite = { ...cells[0], role: "threat" };
  const weakUser = user({ cells: cells.map((cell) => (cell === cells[0] ? { ...cell, score: 0.2 } : cell)) });
  const profile = {
    cells: [politicianCell(cells[1]), politicianCell(cells[2]), politicianCell(opposite, { share: 0.4 })],
    source: "manifesto",
  };
  const withoutOpposite = {
    cells: [politicianCell(cells[1]), politicianCell(cells[2])],
    source: "manifesto",
  };

  assert.equal(
    calculateProfileMatch(weakUser, profile, new Set()).match_score,
    calculateProfileMatch(weakUser, withoutOpposite, new Set()).match_score,
  );
});

test("declinedセルをsilentでも二重加点せず、スコアを0〜100に収める", () => {
  const declined = { frame: "evidence_expertise", target: "国際社会", role: "threat" };
  const active = cells.slice(0, 2).map((cell) => ({ ...cell, share: 0.5 }));
  const result = calculateProfileMatch(user({ cells: active, declined_cells: [declined] }), {
    cells: active.map((cell) => politicianCell(cell, { share: 0.01 })),
  }, new Set(["evidence_expertise|国際社会|threat"]));

  assert.equal(result.reliable, true);
  assert.equal(result.match_score, 96.2);
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
