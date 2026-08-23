// ビルドしたWorkerを直接呼び出し、サーバーサイドレンダリングの結果を検証します。
// 実行前に `npm run build` が必要です (npm run test が自動で実行します)。
import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  // Node のモジュールキャッシュを避けるため、実行ごとに異なるクエリを付けます。
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("トップページがHTMLとして描画される", async () => {
  const response = await render("/");

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
});

test("メタデータにcivic-compassの情報が含まれる", async () => {
  const html = await (await render("/")).text();

  assert.match(html, /<html lang="ja"/);
  assert.match(html, /<title>civic-compass[^<]*<\/title>/);
  assert.match(html, /name="description"[^>]*content="[^"]*政治家[^"]*"/);
});

test("セッション確認中の画面がHTMLとして描画される", async () => {
  const html = await (await render("/")).text();

  assert.match(html, /civic-compass/);
  assert.match(html, /利用情報を確認しています/);
  assert.doesNotMatch(html, /aria-label="メインナビゲーション"/);
});
