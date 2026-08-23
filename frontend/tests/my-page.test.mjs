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

test("APIから受け取ったユーザー名とユーザーIDを表示する", () => {
  const html = renderToStaticMarkup(createElement(MyPage, {
    user: { user_id: "user-123", name: "山田 太郎" },
    status: "ready",
  }));

  assert.match(html, /マイページ/);
  assert.match(html, /山田 太郎/);
  assert.match(html, /ユーザーID：user-123/);
  assert.doesNotMatch(html, /コンパスユーザー|civic-compass を利用中/);
  assert.doesNotMatch(html, /ダミーデータ/);
  assert.match(html, /保存した記事/);
  assert.match(html, /回答した論点/);
  assert.doesNotMatch(html, /フォロー中/);
  assert.doesNotMatch(html, /あなたの関心は非公開です/);
});

test("設定メニューがデモ表示だと分かる", () => {
  const html = renderToStaticMarkup(createElement(MyPage, {
    user: { user_id: "user-123", name: "山田 太郎" },
    status: "ready",
  }));

  assert.match(html, /アカウント設定/);
  assert.match(html, /通知設定/);
  assert.match(html, /プライバシー/);
  assert.match(html, /ヘルプ/);
  assert.match(html, /各項目は操作できません/);
});

test("ユーザー情報の読み込み状態と取得失敗を表示する", () => {
  const loadingHtml = renderToStaticMarkup(createElement(MyPage, { user: null, status: "loading" }));
  const errorHtml = renderToStaticMarkup(createElement(MyPage, { user: null, status: "error" }));

  assert.match(loadingHtml, /ユーザー情報を取得しています/);
  assert.match(errorHtml, /ユーザー情報を読み込めませんでした/);
  assert.doesNotMatch(errorHtml, /コンパスユーザー/);
});
