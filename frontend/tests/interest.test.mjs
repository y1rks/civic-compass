// 関心度のラベル。シートで選んだ言葉と一覧のバッジを一致させるために使います。
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, rm } from "node:fs/promises";
import { transform } from "esbuild";

const compiled = new URL("./interest.compiled.mjs", import.meta.url);
const source = await readFile(new URL("../lib/interest.ts", import.meta.url), "utf8");
const { code } = await transform(source, { loader: "ts", format: "esm" });
await writeFile(compiled, code);
const { INTEREST_LEVELS, DEFAULT_INTEREST, interestLabel, interestIndex } = await import(compiled.href);
test.after(() => rm(compiled, { force: true }));

test("保存した関心度に対応するラベルを返す", () => {
  assert.equal(interestLabel(0), "関心なし");
  assert.equal(interestLabel(0.33), "あまり関心なし");
  assert.equal(interestLabel(0.66), "やや関心あり");
  assert.equal(interestLabel(1), "関心あり");
});

test("段階の刻みに無い値も最も近いラベルに落ちる", () => {
  // DB 側は 0〜1 の実数。3段階だったころの 0.5 が残っていても壊れないこと
  assert.equal(interestLabel(0.1), "関心なし");
  assert.equal(interestLabel(0.4), "あまり関心なし");
  assert.equal(interestLabel(0.5), "やや関心あり");
  assert.equal(interestLabel(0.9), "関心あり");
});

test("目盛りの添字に直せる（スライダーが値ではなく添字を持つため）", () => {
  assert.equal(interestIndex(0), 0);
  assert.equal(interestIndex(0.33), 1);
  assert.equal(interestIndex(0.66), 2);
  assert.equal(interestIndex(1), 3);
  assert.equal(interestIndex(0.5), 2);   // 3段階時代の値も添字に落ちる
});

test("段階は等間隔で、目盛りの位置と値が対応する", () => {
  // UI は添字から位置を出すので、値が等間隔でないと目盛りと意味がずれる
  const step = 1 / (INTEREST_LEVELS.length - 1);
  INTEREST_LEVELS.forEach((level, i) => {
    assert.ok(Math.abs(level.value - i * step) < 0.01, `${level.label} が等間隔でない`);
  });
});

test("「関心なし」だけが 0 で、他は寄与を持つ", () => {
  const zero = INTEREST_LEVELS.filter((level) => level.value === 0);
  assert.equal(zero.length, 1);
  assert.equal(zero[0].label, "関心なし");
  assert.ok(INTEREST_LEVELS.every((level) => level.value >= 0 && level.value <= 1));
});

test("既定値は関心ありの側にある", () => {
  assert.ok(DEFAULT_INTEREST > 0);
  assert.ok(INTEREST_LEVELS.some((level) => level.value === DEFAULT_INTEREST));
});
