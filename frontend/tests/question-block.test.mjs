// 設問ブロックを react-dom/server で描画し、マークアップを検証します。
//
// Node は .ts の型ストリップはできますが .tsx の JSX 変換はできないので、
// ここだけ esbuild（vite が依存として持っている）で変換してから読み込みます。
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, rm } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { transform } from "esbuild";

// 変換結果はワークスペース内に置きます。react や lucide-react の解決に
// node_modules を辿る必要があり、data: URL からは解決できないためです。
const compiled = new URL("./question-block.compiled.mjs", import.meta.url);
const source = await readFile(new URL("../app/question-block.tsx", import.meta.url), "utf8");
const { code } = await transform(source, { loader: "tsx", format: "esm", jsx: "automatic" });
await writeFile(compiled, code);
const { QuestionBlock, isAnswerComplete } = await import(compiled.href);
test.after(() => rm(compiled, { force: true }));

const questions = [
  {
    id: "energy-2035_q1",
    prompt: "発電設備が自然環境に与える影響について",
    frame: "care_harm",
    target: "自然環境",
    role: "beneficiary",
    options: [
      { id: "q1_uphold", stance: "uphold", label: "生態系や景観を壊さないことを優先すべきだ" },
      { id: "q1_override", stance: "override", label: "影響はあるだろうが、それを理由に電力供給を低下させるべきではない" },
      { id: "q1_neutral", stance: "neutral", label: "特に気にならない" },
    ],
  },
];

const render = (props) => renderToStaticMarkup(
  createElement(QuestionBlock, { questions, answers: {}, onAnswer: () => {}, ...props }),
);

test("設問と3つの選択肢が描画される", () => {
  const html = render();

  assert.match(html, /発電設備が自然環境に与える影響について/);
  for (const option of questions[0].options) {
    assert.ok(html.includes(option.label), `選択肢が出ていない: ${option.label}`);
  }
});

test("stance は画面に出さない（賛成／反対と誤解されるため）", () => {
  const html = render();

  // value 属性以外に uphold / override の文字列が出ていないこと
  const visible = html.replace(/value="[^"]*"/g, "").replace(/name="[^"]*"/g, "");
  assert.doesNotMatch(visible, /uphold|override|neutral/);
  // frame / target / role といった内部の語彙も出さない
  assert.doesNotMatch(html, /care_harm|beneficiary/);
});

test("同じ設問の選択肢は単一選択になる（radio かつ name が同一）", () => {
  const html = render();
  const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];

  assert.equal(radios.length, 3);
  for (const radio of radios) {
    assert.match(radio, /name="energy-2035_q1"/);
  }
});

test("選んだ選択肢に selected が付き、回答数が進む", () => {
  const html = render({ answers: { "energy-2035_q1": "override" } });

  assert.match(html, /class="option selected"/);
  assert.equal((html.match(/class="option selected"/g) ?? []).length, 1);
  assert.match(html, /class="question-progress">1\/1</);
});

test("設問のない記事では何も描画しない", () => {
  assert.equal(render({ questions: [] }), "");
});

test("必須選択の判定は全設問に答えたときだけ true になる", () => {
  const two = [questions[0], { ...questions[0], id: "energy-2035_q2" }];

  assert.equal(isAnswerComplete(two, {}), false);
  assert.equal(isAnswerComplete(two, { "energy-2035_q1": "uphold" }), false);
  assert.equal(isAnswerComplete(two, { "energy-2035_q1": "uphold", "energy-2035_q2": "neutral" }), true);
  // 設問のない記事は保存を妨げない
  assert.equal(isAnswerComplete([], {}), true);
});

test("必須であることが画面に出ている", () => {
  assert.match(render(), /（必須選択）/);
});
