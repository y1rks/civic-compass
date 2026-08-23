import assert from "node:assert/strict";
import parties from "../../scripts/kokkai/parties.json" with { type: "json" };
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

test("総合マッチをGETで返し、evidence は読まない", async () => {
  const { response, calls } = await request();
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.reliable, true);
  assert.deepEqual(data.matches.map((match) => match.speaker_id), ["P00001", "P00002", "P00003"]);
  assert.deepEqual(calls.filter((key) => key.startsWith("profile:evidence:")), []);
  assert.equal(calls.filter((key) => key === "list:cellidx:").length, 1);
  assert.deepEqual(data.party_matches.map(({ reasons: _reasons, differences: _differences, ...party }) => party), [{
    party_id: "PT01",
    party: "自由民主党",
    short_name: "自民",
    website: "https://www.jimin.jp/",
    seats: { shugiin: 316, sangiin: 101 },
    color: "#3CA324",
    source: "members",
    match_score: 69.3,
    matched_cells: 2,
    n_politicians: 3,
  }]);
  assert.equal(data.party_matches[0].reasons.length, 2);
});

// 候補議員の所属党だけを見ると、プロファイルを作った15人の党しか出てきません。
// 公約だけでプロファイルを作った党も並べるため、党の一覧は parties.json が正です。
test("議席を持つ全政党のプロファイルを読む", async () => {
  const { calls } = await request();
  const asked = calls.filter((key) => key.startsWith("profile:party:"));

  assert.equal(asked.length, parties.parties.filter((party) => party.active !== false).length);
  assert.ok(asked.includes("profile:party:社会民主党"));
});

// 政治コンパス画面は発言の原文を出さないので、何人並べても evidence は読みません。
test("議員は上位7人までにし、evidence は1件も読まない", async () => {
  const ids = ["P00001", "P00002", "P00003", "P00004", "P00005", "P00006", "P00007", "P00008", "P00010"];
  const many = new Map(profiles);
  // share が大きいほどマッチが高くなるので、ID順がそのまま順位になります。
  ids.forEach((speakerId, index) => many.set(`profile:${speakerId}`, {
    speaker_id: speakerId,
    politician_name: speakerId,
    party: "自由民主党",
    house: "衆議院",
    cells: cells(0.1 - index * 0.01),
  }));

  const { response, calls } = await request({ values: many });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(data.matches.map((match) => match.speaker_id), ids.slice(0, 7));
  assert.deepEqual(calls.filter((key) => key.startsWith("profile:evidence:")), []);
  assert.ok(data.matches.every((match) => !("evidence" in match)));
});

// 政党も議員と同じ7件までにします（タブを切り替えても母数が変わって見えないように）。
test("政党も上位7党までにする", async () => {
  const names = parties.parties.filter((party) => party.active !== false).map((party) => party.name);
  const many = new Map(profiles);
  // 突出度が高いほどマッチが高くなるので、parties.json の並び順がそのまま順位になります。
  names.slice(0, 9).forEach((name, index) => many.set(`profile:party:${name}`, {
    party: name,
    n_politicians: 1,
    politicians: ["P00001"],
    cells: cells(0.1).map((cell) => ({ ...cell, distinctiveness: 2 - index * 0.15 })),
  }));

  const data = await (await request({ values: many })).response.json();

  assert.equal(data.party_matches.length, 7);
  assert.deepEqual(data.party_matches.map((party) => party.party), names.slice(0, 7));
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
