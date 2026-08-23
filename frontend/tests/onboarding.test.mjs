import assert from "node:assert/strict";
import test from "node:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transform } from "esbuild";

const sourceUrl = new URL("../app/onboarding.tsx", import.meta.url);
const outputUrl = new URL("../app/onboarding.compiled.mjs", import.meta.url);
const { code } = await transform(await readFile(sourceUrl, "utf8"), {
  loader: "tsx",
  format: "esm",
  jsx: "automatic",
});
await writeFile(outputUrl, code);
const { Onboarding } = await import(outputUrl.href);
test.after(() => rm(outputUrl, { force: true }));

const props = {
  submitting: false,
  error: null,
  onSubmit: async () => {},
  onRetry: () => {},
};

test("初回利用時に名前だけを入力する画面を表示する", () => {
  const html = renderToStaticMarkup(createElement(Onboarding, { ...props, status: "anonymous" }));

  assert.match(html, /はじめまして/);
  assert.match(html, /アプリで使用する名前/);
  assert.match(html, /name="name"/);
  assert.match(html, /はじめる/);
  assert.doesNotMatch(html, /メール|パスワード|ログイン/);
});

test("セッション確認中と通信エラーを表示する", () => {
  const loading = renderToStaticMarkup(createElement(Onboarding, { ...props, status: "loading" }));
  const error = renderToStaticMarkup(createElement(Onboarding, { ...props, status: "error" }));

  assert.match(loading, /利用情報を確認しています/);
  assert.match(error, /利用情報を確認できませんでした/);
  assert.match(error, /もう一度試す/);
});
