import assert from "node:assert/strict";
import test from "node:test";

async function request(path, init) {
  const workerUrl = new URL("../dist/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: app } = await import(workerUrl.href);

  return app.fetch(new Request(`http://localhost${path}`, init), { DB: {} }, {});
}

test("記事単位の政治家マッチAPIが3人を返す", async () => {
  const response = await request("/api/matches/energy-2035");
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.matches.length, 3);
  assert.equal(data.matches[0].score, 92);
});

test("旧総合マッチAPIはGETへの移行を案内する", async () => {
  const response = await request("/api/matches/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ articleIds: ["energy-2035", "childcare"] }),
  });
  const data = await response.json();

  assert.equal(response.status, 405);
  assert.match(data.message, /GET \/api\/matches\/profile/);
});
