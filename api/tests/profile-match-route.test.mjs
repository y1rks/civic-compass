import assert from "node:assert/strict";
import test from "node:test";

const userProfile = {
  user_id: "test_user1",
  computed_at: "2026-08-22T00:00:00.000Z",
  profile_version: "user-profile-v1.0",
  n_answers: 5,
  n_selections: 10,
  cells: [
    { frame: "care_harm", target: "自然環境", role: "beneficiary", score: 1, share: 0.5, n: 1 },
    { frame: "fairness", target: "地方", role: "beneficiary", score: 1, share: 0.5, n: 1 },
  ],
  declined_cells: [],
  override_rate: 0.066,
  override_weight: 3.718,
};

const cells = (share) => userProfile.cells.map((cell) => ({
  ...cell,
  share,
  n: 3,
  distinctiveness: 1,
}));

const profiles = new Map([
  ["profile:P00001", { speaker_id: "P00001", politician_name: "高市早苗", party: "自由民主党", house: "衆議院", cells: cells(0.5) }],
  ["profile:P00002", { speaker_id: "P00002", politician_name: "河野太郎", party: "自由民主党", house: "衆議院", cells: cells(0.3) }],
  ["profile:P00003", { speaker_id: "P00003", politician_name: "小泉進次郎", party: "自由民主党", house: "衆議院", cells: cells(0.2) }],
  ["profile:party:自由民主党", {
    party: "自由民主党",
    n_politicians: 3,
    politicians: ["P00001", "P00002", "P00003"],
    cells: cells(0.4).map(({ distinctiveness: _distinctiveness, ...cell }) => cell),
  }],
  ["profile:evidence:P00001", {
    cells: {
      "care_harm|自然環境|beneficiary": [{
        date: "2026-01-01",
        summary: "環境への影響を抑える必要性を述べた。",
        url: "https://kokkai.ndl.go.jp/example",
        quote: "前段根拠箇所後段",
        block_text: null,
        evidence_text: "根拠箇所",
        evidence_span: [2, 6],
      }],
      "fairness|地方|beneficiary": [{
        date: null,
        summary: "地方への公正な配分を掲げた。",
        url: "https://example.com/policy",
      }],
    },
  }],
  ["profile:evidence:P00002", { cells: {} }],
  ["profile:evidence:P00003", { cells: {} }],
]);

async function request({ user = userProfile, values = profiles, paginated = false } = {}) {
  const workerUrl = new URL("../dist/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: app } = await import(workerUrl.href);
  const calls = [];
  const politicianKv = {
    get: async (key) => {
      calls.push(key);
      return values.get(key) ?? null;
    },
    list: async ({ prefix, cursor }) => {
      calls.push(`list:${prefix}`);
      assert.equal(prefix, "cellidx:");
      if (paginated && cursor === undefined) {
        return {
          keys: [{ name: "cellidx:care_harm|自然環境|beneficiary" }],
          list_complete: false,
          cursor: "next-page",
        };
      }
      if (paginated) assert.equal(cursor, "next-page");
      else assert.equal(cursor, undefined);
      return {
        keys: paginated
          ? [{ name: "cellidx:fairness|地方|beneficiary" }]
          : [
            { name: "cellidx:care_harm|自然環境|beneficiary" },
            { name: "cellidx:fairness|地方|beneficiary" },
          ],
        list_complete: true,
      };
    },
  };
  const userKv = { get: async (key) => {
    assert.equal(key, "profile:user:test_user1");
    return user;
  } };

  const response = await app.fetch(
    new Request("http://localhost/api/matches/profile"),
    { PROFILES: politicianKv, USER_PROFILES: userKv },
    {},
  );
  return { response, calls };
}

test("総合マッチをGETで返し、上位3人だけ根拠を読む", async () => {
  const { response, calls } = await request();
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.reliable, true);
  assert.deepEqual(data.matches.map((match) => match.speaker_id), ["P00001", "P00002", "P00003"]);
  assert.equal(calls.filter((key) => key.startsWith("profile:evidence:")).length, 3);
  assert.equal(calls.filter((key) => key === "list:cellidx:").length, 1);
  assert.deepEqual(data.party_matches, [{
    party: "自由民主党",
    match_score: 62,
    matched_cells: 2,
    n_politicians: 3,
  }]);
});

test("国会会議録だけ原文を返し、公式サイト由来は要約とURLに限定する", async () => {
  const data = await (await request()).response.json();
  const [kokkai, website] = data.matches[0].evidence;

  assert.equal(kokkai.quote, "前段根拠箇所後段");
  assert.equal(kokkai.highlight, "根拠箇所");
  assert.equal(website.summary, "地方への公正な配分を掲げた。");
  assert.ok(!("quote" in website));
  assert.ok(!("highlight" in website));
});

test("回答が5記事未満なら議員プロファイルを読まず信頼性不足を返す", async () => {
  const { response, calls } = await request({ user: { ...userProfile, n_answers: 4 } });
  const data = await response.json();

  assert.equal(data.reliable, false);
  assert.deepEqual(data.matches, []);
  assert.equal(calls.length, 0);
});

test("ユーザープロファイルがなければ信頼性不足を返す", async () => {
  const data = await (await request({ user: null })).response.json();
  assert.equal(data.reliable, false);
  assert.deepEqual(data.party_matches, []);
});

test("cellidxのキー一覧を最終ページまで読む", async () => {
  const { response, calls } = await request({ paginated: true });
  assert.equal(response.status, 200);
  assert.equal(calls.filter((key) => key === "list:cellidx:").length, 2);
});
