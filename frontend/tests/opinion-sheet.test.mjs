// 意見入力シートを描画し、構成と保存ボタンの活性を検証します。
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, rm } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { transform } from "esbuild";

const ROOT = new URL("../../frontend/app/", import.meta.url);
const compileInterest = async () => {
  const out = new URL("../lib/interest.compiled.mjs", ROOT);
  const source = await readFile(new URL("../lib/interest.ts", ROOT), "utf8");
  const { code } = await transform(source, { loader: "ts", format: "esm" });
  await writeFile(out, code);
  return out;
};
const compile = async (name) => {
  const out = new URL(`./${name}.compiled.mjs`, ROOT);
  const source = await readFile(new URL(`./${name}.tsx`, ROOT), "utf8");
  const { code } = await transform(source, { loader: "tsx", format: "esm", jsx: "automatic" });
  // Node の ESM は拡張子なしの指定を解決できないので、変換後に補います。
  // テストで読み込む TypeScript も ESM に変換し、Node の対応状況に依存させません。
  await writeFile(out, code
    .replaceAll('"./question-block"', '"./question-block.compiled.mjs"')
    .replaceAll('"../lib/interest"', '"../lib/interest.compiled.mjs"'));
  return out;
};
const interestUrl = await compileInterest();
const qb = await compile("question-block");
const sheetUrl = await compile("opinion-sheet");
const { OpinionSheet } = await import(sheetUrl.href);
test.after(async () => {
  await rm(interestUrl, { force: true });
  await rm(qb, { force: true });
  await rm(sheetUrl, { force: true });
});

const article = {
  id: "energy-2035", category: "環境", title: "t", summary: "s", body: [], image: "", source: "", publishedAt: "",
  questions: [{
    id: "q1", prompt: "発電設備が自然環境に与える影響について", frame: "care_harm", target: "自然環境", role: "beneficiary",
    options: [
      { id: "a", stance: "uphold", label: "生態系や景観を壊さないことを優先すべきだ" },
      { id: "b", stance: "override", label: "影響はあるだろうが、それを理由に電力供給を低下させるべきではない" },
      { id: "c", stance: "neutral", label: "特に気にならない" },
    ],
  }],
};
const render = (props) => renderToStaticMarkup(createElement(OpinionSheet, {
  article, interest: 1, onInterest: () => {}, answers: {}, onAnswer: () => {},
  comment: "", setComment: () => {}, saving: false, onCancel: () => {}, onSave: () => {}, ...props,
}));

test("シートに関心度・設問・コメント・2つのボタンが並ぶ", () => {
  const html = render();
  assert.match(html, /このニュースへの関心度/);
  assert.match(html, /関心なし/);
  assert.match(html, /やや関心あり/);
  assert.match(html, /関心あり/);
  assert.match(html, /考えに近いものを選んでください。/);
  assert.match(html, /（必須選択）/);
  assert.match(html, /思ったこと・考えたこと/);
  assert.match(html, /（任意）/);
  assert.match(html, /キャンセル/);
  assert.match(html, /保存する/);
});

test("自由記述は枠のあるテキストボックスとして描画される", () => {
  const html = render();
  assert.match(html, /class="comment-box"/);
  assert.match(html, /<textarea[^>]*placeholder="なぜそう思いましたか？"/);
});

test("ヘッダーのアイコンはコメントアイコン（ハートではない）", () => {
  const html = render();
  assert.match(html, /class="sheet-icon"/);
  assert.match(html, /lucide-message-circle-more/);
  assert.doesNotMatch(html, /lucide-heart/);
});

test("ハンドルはシートを閉じる操作として利用できる", () => {
  const html = render();
  assert.match(html, /<button[^>]*class="sheet-grabber"[^>]*aria-label="シートを閉じる"/);
});

test("キャンセルが左、保存が右に並ぶ", () => {
  const html = render();
  assert.ok(html.indexOf("キャンセル") < html.indexOf(">保存する<"), "保存が左に来ている");
  assert.match(html, /class="sheet-actions"/);
});

test("未回答のあいだ保存ボタンは押せない", () => {
  const html = render();
  assert.match(html, /class="primary-button" disabled=""/);
  assert.match(html, /すべての設問に答えると保存できます。/);
});

test("すべて答えると保存ボタンが押せるようになる", () => {
  const html = render({ answers: { q1: "override" } });
  assert.doesNotMatch(html, /class="primary-button" disabled=""/);
  assert.doesNotMatch(html, /すべての設問に答えると保存できます。/);
});

test("選んだ関心度が選択状態になる", () => {
  const html = render({ interest: 0.66 });
  assert.match(html, /class="interest-label selected"[^>]*aria-pressed="true">やや関心あり</);
});

test("関心度はスライダーで、目盛りの添字を値として持つ", () => {
  // 値そのもの（0.66）を range に入れると浮動小数の誤差で端が選べなくなる
  const html = render({ interest: 0.66 });
  assert.match(html, /type="range"[^>]*max="3"/);
  assert.match(html, /value="2"/);
  assert.match(html, /aria-valuetext="やや関心あり"/);
});

test("4段階すべてが目盛りとして並ぶ", () => {
  const html = render();
  for (const label of ["関心なし", "あまり関心なし", "やや関心あり", "関心あり"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
});
