import assert from "node:assert/strict";
import test from "node:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transform } from "esbuild";

const sourceUrl = new URL("../app/my-page.tsx", import.meta.url);
const outputUrl = new URL("../app/my-page.compiled.mjs", import.meta.url);
const { code } = await transform(await readFile(sourceUrl, "utf8"), {
  loader: "tsx",
  format: "esm",
  jsx: "automatic",
});
await writeFile(outputUrl, code);
const { MyPage } = await import(outputUrl.href);
test.after(() => rm(outputUrl, { force: true }));

test("ダミーのユーザー情報と活動サマリーを表示する", () => {
  const html = renderToStaticMarkup(createElement(MyPage));

  assert.match(html, /マイページ/);
  assert.match(html, /コンパスユーザー/);
  assert.match(html, /ダミーデータ/);
  assert.match(html, /保存した記事/);
  assert.match(html, /回答した論点/);
  assert.match(html, /フォロー中/);
});

test("設定メニューがデモ表示だと分かる", () => {
  const html = renderToStaticMarkup(createElement(MyPage));

  assert.match(html, /アカウント設定/);
  assert.match(html, /通知設定/);
  assert.match(html, /プライバシー/);
  assert.match(html, /ヘルプ/);
  assert.match(html, /各項目は操作できません/);
});
