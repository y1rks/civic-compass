import assert from "node:assert/strict";
import test from "node:test";

const baseCell = {
  frame: "care_harm",
  target: "子ども・将来世代",
  role: "beneficiary",
  score: -1,
  share: 0.5,
  n: 1,
};

const profile = (cells) => JSON.stringify({ user_id: "test_user1", cells });

async function request(raw) {
  const workerUrl = new URL("../dist/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: app } = await import(workerUrl.href);
  const kv = { get: async (key) => {
    assert.equal(key, "profile:user:test_user1");
    return raw;
  } };
  return app.fetch(new Request("http://localhost/api/user-profile"), { USER_PROFILES: kv }, {});
}

test("shareが高い順に上位3セルを返す", async () => {
  const cells = [
    { ...baseCell, frame: "fairness", target: "地方", share: 0.2 },
    { ...baseCell, frame: "sovereignty", target: "国際社会", role: "threat", share: 0.8 },
    { ...baseCell, frame: "efficiency_utility", target: "国民全体", share: 0.6 },
    { ...baseCell, share: 0.7 },
  ];
  const response = await request(profile(cells));
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(data.cells.map((cell) => cell.share), [0.8, 0.7, 0.6]);
});

test("3件未満なら存在するセルだけを返す", async () => {
  const response = await request(profile([baseCell]));
  const data = await response.json();
  assert.deepEqual(data.cells, [baseCell]);
});

test("プロファイルが未作成なら空配列を返す", async () => {
  const response = await request(null);
  assert.deepEqual(await response.json(), { cells: [] });
});

test("shareが同じセルは組み合わせで表示順を固定する", async () => {
  const cells = [
    { ...baseCell, frame: "fairness", target: "地方" },
    { ...baseCell, frame: "care_harm", target: "自然環境" },
    { ...baseCell, frame: "care_harm", target: "子ども・将来世代" },
  ];
  const data = await (await request(profile(cells))).json();
  assert.deepEqual(data.cells.map((cell) => `${cell.frame}|${cell.target}`), [
    "care_harm|子ども・将来世代",
    "care_harm|自然環境",
    "fairness|地方",
  ]);
});

test("壊れたKVデータはエラーにする", async () => {
  assert.equal((await request("not-json")).status, 500);
  assert.equal((await request(JSON.stringify({ cells: [{ ...baseCell, score: "1" }] }))).status, 500);
});
