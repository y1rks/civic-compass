import assert from "node:assert/strict";
import test from "node:test";

const baseCell = {
  frame: "care_harm",
  target: "子ども・将来世代",
  role: "beneficiary",
  score: 1,
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

test("scoreが高い順に上位3セルを返す", async () => {
  const cells = [
    { ...baseCell, frame: "fairness", target: "地方", score: 0.4 },
    { ...baseCell, frame: "sovereignty", target: "国際社会", role: "threat", score: 1 },
    { ...baseCell, frame: "efficiency_utility", target: "国民全体", score: 0.2 },
    { ...baseCell, score: 0.6 },
  ];
  const response = await request(profile(cells));
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(data.cells.map((cell) => cell.score), [1, 0.6, 0.4]);
});

test("scoreが同点なら share（言及度）で割る", async () => {
  // 設問1問につき1セルなので、いまの設問カタログでは score は ±1 の2値にしかならない。
  // 同点が常態なので、この副次条件が実質の並び順になる。
  const cells = [
    { ...baseCell, frame: "fairness", target: "地方", score: 1, share: 0.2 },
    { ...baseCell, frame: "sovereignty", target: "国際社会", score: 1, share: 0.8 },
    { ...baseCell, frame: "efficiency_utility", target: "国民全体", score: 1, share: 0.5 },
  ];
  const data = await (await request(profile(cells))).json();
  assert.deepEqual(data.cells.map((cell) => cell.share), [0.8, 0.5, 0.2]);
});

test("★score が 0 以下のセルは返さない（重視している考え方として並べると意味が逆になる）", async () => {
  const cells = [
    { ...baseCell, frame: "fairness", target: "地方", score: -1 },
    { ...baseCell, frame: "sovereignty", target: "国際社会", score: 0 },
    { ...baseCell, frame: "efficiency_utility", target: "国民全体", score: 0.3 },
  ];
  const data = await (await request(profile(cells))).json();

  assert.deepEqual(data.cells.map((cell) => cell.frame), ["efficiency_utility"]);
});

test("該当が1件も無ければ空配列を返す（画面側が回答を促す）", async () => {
  const cells = [
    { ...baseCell, frame: "fairness", target: "地方", score: -1 },
    { ...baseCell, frame: "sovereignty", target: "国際社会", score: 0 },
  ];
  assert.deepEqual(await (await request(profile(cells))).json(), { cells: [] });
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

test("score も share も同じセルは組み合わせで表示順を固定する", async () => {
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
