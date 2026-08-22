// ユーザープロファイルの集計。議員側と同じ式を使えているかを確かめます。
import assert from "node:assert/strict";
import test from "node:test";

// 集計は D1 に依存しないので shared 側にあります。そのまま読めます。
const { aggregateUserProfile } = await import("../../shared/src/user-profile.ts");

const row = (over) => ({
  interest: 1, answerId: "a1", stance: "uphold",
  frame: "care_harm", target: "自然環境", role: "beneficiary",
  intensity: 0.7, confidence: 0.9, ...over,
});
const build = (rows) => aggregateUserProfile(rows, "u1", "2026-08-22T00:00:00Z");

test("積極的に語ったセルだけが cells に入る", () => {
  const p = build([
    row({ answerId: "a1" }),
    row({ answerId: "a2", interest: 0, target: "地方" }),          // 記事ごと「関心がない」
    row({ answerId: "a3", stance: "neutral", target: "国民全体" }), // 設問ごと「特に気にならない」
  ]);

  assert.deepEqual(p.cells.map((c) => c.target), ["自然環境"]);
  assert.deepEqual(p.declined_cells.map((c) => c.target).sort(), ["国民全体", "地方"]);
});

test("interest = 0 のセルは share を持たない（平滑化で紛れ込ませない）", () => {
  const p = build([row({ answerId: "a1" }), row({ answerId: "a2", interest: 0, target: "地方" })]);

  // 1セルしか無いので share は 1.0 になる。関心がないセルが割り込むと 0.5 付近に落ちる。
  assert.equal(p.cells.length, 1);
  assert.equal(p.cells[0].share, 1);
});

test("同じセルを語りもし降りもしたら、語ったほうを採る", () => {
  const p = build([row({ answerId: "a1" }), row({ answerId: "a2", stance: "neutral" })]);

  assert.equal(p.cells.length, 1);
  assert.deepEqual(p.declined_cells, []);
});

test("override は score を負にし、uphold と打ち消し合わない重みを持つ", () => {
  const upheld = build([row({})]);
  const overridden = build([row({ stance: "override" })]);

  assert.equal(upheld.cells[0].score, 1);
  assert.equal(overridden.cells[0].score, -1);
});

test("回答が10件未満のうちは全議員平均の override 率を使う", () => {
  const p = build([row({}), row({ answerId: "a2", stance: "override", target: "地方" })]);

  // 本人の実測は 1/2 = 50% だが、回答2件なので平均 6.6% を使う
  assert.equal(p.override_rate, 0.066);
  assert.equal(p.override_weight, 3.718);
});

test("回答が10件を超えたら本人の実測値に切り替える", () => {
  const rows = Array.from({ length: 12 }, (_, i) =>
    row({ answerId: `a${i}`, target: `t${i}`, stance: i === 0 ? "override" : "uphold" }));
  const p = build(rows);

  assert.equal(p.override_rate, Math.round((1 / 12) * 1000) / 1000);
  assert.notEqual(p.override_rate, 0.066);
});

test("interest が share に効く（関心の高い記事のセルが重くなる）", () => {
  const p = build([
    row({ answerId: "a1", interest: 1, target: "自然環境" }),
    row({ answerId: "a2", interest: 0.5, target: "地方" }),
  ]);

  const strong = p.cells.find((c) => c.target === "自然環境");
  const weak = p.cells.find((c) => c.target === "地方");
  assert.ok(strong.share > weak.share, "関心度が share に効いていない");
  // ただし平滑化で差は圧縮される（2倍の関心度が2倍の share にはならない）
  assert.ok(strong.share < weak.share * 2);
});

test("重視したセルが share にはっきり出る（擬似寄与に押し切られない）", () => {
  // 同じセルに5問、他の4セルに1問ずつ。生の寄与の比は 5:1。
  const rows = [
    ...Array.from({ length: 5 }, (_, i) => row({ answerId: `a${i}`, target: "自然環境" })),
    ...["地方", "個人", "国民全体", "女性"].map((target, i) => row({ answerId: `b${i}`, target })),
  ];
  const p = build(rows);
  const strong = p.cells.find((c) => c.target === "自然環境");
  const weak = p.cells.find((c) => c.target === "地方");

  // 議員側の SHARE_PRIOR = 4.0 を当てると 1.5倍まで潰れ、マッチ計算の
  // sqrt(u.share × p.share) がほぼ定数になって「何を重視したか」が効かなくなる。
  assert.ok(strong.share > weak.share * 3, `重視度が潰れている: ${strong.share} / ${weak.share}`);
});

test("distinctiveness はユーザー側では持たない", () => {
  const p = build([row({})]);
  assert.ok(p.cells.every((c) => !("distinctiveness" in c)));
});

test("回答が無ければ空のプロファイルになる", () => {
  const p = build([]);
  assert.deepEqual(p.cells, []);
  assert.deepEqual(p.declined_cells, []);
  assert.equal(p.n_answers, 0);
});
