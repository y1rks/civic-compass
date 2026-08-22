// 関心度のラベル。シートで選んだ言葉と一覧のバッジを一致させるために使います。
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, rm } from "node:fs/promises";
import { transform } from "esbuild";

const compiled = new URL("./interest.compiled.mjs", import.meta.url);
const source = await readFile(new URL("../lib/interest.ts", import.meta.url), "utf8");
const { code } = await transform(source, { loader: "ts", format: "esm" });
await writeFile(compiled, code);
const { INTEREST_LEVELS, DEFAULT_INTEREST, interestLabel } = await import(compiled.href);
test.after(() => rm(compiled, { force: true }));

test("保存した関心度に対応するラベルを返す", () => {
  assert.equal(interestLabel(0), "関心がない");
  assert.equal(interestLabel(0.5), "やや関心あり");
  assert.equal(interestLabel(1), "関心あり");
});

test("段階を増やしても最も近いラベルに落ちる", () => {
  // DB 側は 0〜1 の実数なので、選択肢に無い値が入りうる
  assert.equal(interestLabel(0.1), "関心がない");
  assert.equal(interestLabel(0.4), "やや関心あり");
  assert.equal(interestLabel(0.9), "関心あり");
});

test("「関心がない」だけが 0 で、他は寄与を持つ", () => {
  const zero = INTEREST_LEVELS.filter((level) => level.value === 0);
  assert.equal(zero.length, 1);
  assert.equal(zero[0].label, "関心がない");
  assert.ok(INTEREST_LEVELS.every((level) => level.value >= 0 && level.value <= 1));
});

test("既定値は関心ありの側にある", () => {
  assert.ok(DEFAULT_INTEREST > 0);
  assert.ok(INTEREST_LEVELS.some((level) => level.value === DEFAULT_INTEREST));
});
