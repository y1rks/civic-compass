// B（意見保存直後のポップアップ）。D1 と KV をモックして、
// 「どの論点を、誰の、どの発言で見せるか」を検証します。
import assert from "node:assert/strict";
import test from "node:test";

// perspectives.ts の select と同じ列順。
// （interest, questionId, prompt, stance, frame, target, role）
const selectionRows = [
  [1, "energy-2035_q1", "発電設備が自然環境に与える影響について", "uphold", "care_harm", "自然環境", "beneficiary"],
  [1, "energy-2035_q2", "電気料金への影響について", "override", "efficiency_utility", "国民全体", "beneficiary"],
];

function createDbMock(rows = selectionRows) {
  return {
    prepare() {
      const statement = {
        bind() { return statement; },
        raw: async () => rows.map((row) => [...row]),
      };
      return statement;
    },
  };
}

// 【2b】cellidx（セル→議員の逆引き）。★role では絞らず両方を読むので、
// 同じ frame × target の beneficiary と threat の両方を用意します。
const entry = (id, name, score, share, extra = {}) => ({
  speaker_id: id, politician_name: name, party: "自由民主党", score, share,
  distinctiveness: 1.2, n: 12, ...extra,
});

// 立場は **符号ではなく、その論点の中での相対的な近さ**（最大と最小の中点）で分かれる。
// 回答 q1 は uphold なので、score が +1 に近いほど「似た立場」。
// 近い4人・遠い2人・role 違い1人にして、多いほうから埋まることを見る。
const cellIndex = {
  "cellidx:care_harm|自然環境|beneficiary": [
    entry("P00001", "似A", 0.91, 0.032),
    entry("P00004", "似B", 0.88, 0.030),
    entry("P00005", "似C", 0.85, 0.028),
    entry("P00006", "似D", 0.80, 0.026),
    entry("P00002", "逆A", -0.55, 0.018),
    entry("P00007", "逆B", -0.60, 0.016),
  ],
  // 同じ観点を「問題視する立場」で語っている議員。role が違うので立場は比べられない。
  "cellidx:care_harm|自然環境|threat": [
    entry("P00003", "脅威A", 1, 0.024),
  ],
  "cellidx:efficiency_utility|国民全体|beneficiary": [
    entry("P00001", "似A", 1, 0.082, { n: 168 }),
  ],
};

const kokkai = (date, summary, url, text) => ({
  date, summary, url, quote: text, block_text: null, evidence_text: text, evidence_span: [0, text.length],
});

/** 選抜されうる議員は全員 evidence を持たせる（実データでも cellidx の全行に evidence がある）。 */
const filler = Object.fromEntries(
  ["P00004", "P00005", "P00006", "P00007"].map((id) => [
    `profile:evidence:${id}`,
    { speaker_id: id, cells: { "care_harm|自然環境|beneficiary": [kokkai("2026-01-01", "要約", `https://kokkai.ndl.go.jp/txt/${id}/1`, "発言であります。")] } },
  ]),
);

const evidence = {
  ...filler,
  "profile:evidence:P00001": {
    speaker_id: "P00001",
    cells: {
      "care_harm|自然環境|beneficiary": [
        {
          date: "2026-07-15", summary: "生態系への影響を抑えるべきだという立場",
          url: "https://kokkai.ndl.go.jp/txt/1/1",
          quote: "前置きです。景観と生態系を守ることが第一であります。",
          block_text: null,
          evidence_text: "景観と生態系を守ることが第一であります。",
          evidence_span: [6, 29],
        },
        // 公式サイト由来（著作物）。quote が無いので原文は出せない。
        { date: "2026-06-01", summary: "自然環境への配慮を訴えた", url: "https://example.com/post/1" },
        kokkai("2026-05-01", "3件目", "https://kokkai.ndl.go.jp/txt/1/3", "3件目の発言であります。"),
      ],
      "efficiency_utility|国民全体|beneficiary": [
        kokkai("2026-04-02", "費用対効果で判断すべきだという立場", "https://kokkai.ndl.go.jp/txt/2/2", "費用対効果で判断すべきであります。"),
      ],
      // role 違いのテスト用。実データでも cellidx の行には必ず evidence がある。
      "care_harm|自然環境|threat": [
        kokkai("2026-02-02", "自然が事業の妨げになっていると語った", "https://kokkai.ndl.go.jp/txt/1/9", "自然を理由にした反対が事業を止めております。"),
      ],
    },
  },
  "profile:evidence:P00002": {
    speaker_id: "P00002",
    cells: {
      "care_harm|自然環境|beneficiary": [
        kokkai("2026-03-03", "環境影響より供給を優先する立場", "https://kokkai.ndl.go.jp/txt/3/3", "供給の安定を優先すべきです。"),
      ],
    },
  },
  "profile:evidence:P00003": {
    speaker_id: "P00003",
    cells: {
      "care_harm|自然環境|threat": [
        kokkai("2026-02-02", "自然環境が事業の妨げになっていると語った", "https://kokkai.ndl.go.jp/txt/4/4", "自然を理由にした反対が事業を止めております。"),
      ],
    },
  },
};

function createKvMock(index = cellIndex, docs = evidence) {
  const reads = [];
  return {
    reads,
    get: async (key) => {
      reads.push(key);
      return index[key] ?? docs[key] ?? null;
    },
  };
}

async function request(path, db = createDbMock(), kv = createKvMock()) {
  const workerUrl = new URL("../dist/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: app } = await import(workerUrl.href);

  const response = await app.fetch(new Request(`http://localhost${path}`), { DB: db, PROFILES: kv }, {});
  return { response, kv };
}

test("論点は frame × target で束ね、role では絞らない", async () => {
  const { response, kv } = await request("/api/perspectives/energy-2035");
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.perspectives.length, 2);

  // beneficiary と threat の両方を逆引きしている
  assert.equal(kv.reads.includes("cellidx:care_harm|自然環境|beneficiary"), true);
  assert.equal(kv.reads.includes("cellidx:care_harm|自然環境|threat"), true);
});

test("どちらの立場の発言かをカードに出せる（role を畳まない）", async () => {
  // threat の議員が必ず選ばれるよう、beneficiary 側を1人だけにする
  const index = {
    ...cellIndex,
    "cellidx:care_harm|自然環境|beneficiary": [entry("P00001", "似A", 0.91, 0.032)],
  };
  const { response } = await request("/api/perspectives/energy-2035", createDbMock(), createKvMock(index));
  const data = await response.json();
  const labels = new Map(data.perspectives[0].politicians.map((p) => [p.role, p.roleLabel]));

  assert.equal(labels.get("beneficiary"), "守る立場");
  assert.equal(labels.get("threat"), "問題視する立場");
});

test("両方の立場がそろう論点は3人まで", async () => {
  const { response } = await request("/api/perspectives/energy-2035");
  const data = await response.json();

  // 候補は7人いるが3人に絞る
  assert.equal(data.perspectives[0].politicians.length, 3);
});

test("「似た立場」と「異なる立場」を最低1人ずつ混ぜ、残りは多いほうから埋める", async () => {
  // ランダム選抜なので繰り返して、毎回この条件を満たすことを見る
  for (let i = 0; i < 20; i++) {
    const { response } = await request("/api/perspectives/energy-2035");
    const data = await response.json();
    const alignments = data.perspectives[0].politicians.map((p) => p.alignment);

    assert.equal(alignments.length, 3);
    assert.equal(alignments.filter((a) => a === "same").length >= 1, true, "似た立場が1人もいない");
    assert.equal(alignments.filter((a) => a === "different").length >= 1, true, "異なる立場が1人もいない");
    // 近い4人・遠い3人（逆2人 + role 違い1人）なので、残り1枠は似た立場から
    assert.equal(alignments.filter((a) => a === "same").length, 2);
  }
});

test("同じ議員を1つの論点に2枚出さない", async () => {
  // role 違いで両方の側に載っている議員がいると、3枠のうち2枠を1人が占めてしまう
  const index = {
    ...cellIndex,
    "cellidx:care_harm|自然環境|threat": [entry("P00001", "似A", 1, 0.024)],
  };
  for (let i = 0; i < 20; i++) {
    const { response } = await request("/api/perspectives/energy-2035", createDbMock(), createKvMock(index));
    const data = await response.json();
    const ids = data.perspectives[0].politicians.map((p) => p.speakerId);

    assert.equal(new Set(ids).size, ids.length, `同じ議員が2枚出た: ${ids.join(",")}`);
    // 重複を除いても、両方の立場は必ず1人以上出る
    const alignments = data.perspectives[0].politicians.map((p) => p.alignment);
    assert.equal(alignments.includes("same"), true);
    assert.equal(alignments.includes("different"), true);
  }
});

test("残り1枠は人数の多いほうから埋める（異なる立場が多い場合）", async () => {
  const index = {
    ...cellIndex,
    "cellidx:care_harm|自然環境|threat": [],
    "cellidx:care_harm|自然環境|beneficiary": [
      entry("P00001", "似A", 0.91, 0.032),
      entry("P00002", "逆A", -0.55, 0.030),
      entry("P00007", "逆B", -0.60, 0.028),
      entry("P00004", "逆C", -0.70, 0.026),
    ],
  };
  const { response } = await request("/api/perspectives/energy-2035", createDbMock(), createKvMock(index));
  const data = await response.json();
  const alignments = data.perspectives[0].politicians.map((p) => p.alignment);

  assert.equal(alignments.filter((a) => a === "same").length, 1);
  assert.equal(alignments.filter((a) => a === "different").length, 2);
});

test("全員が同じ扱い方をしている論点では、立場を分けない", async () => {
  // 実データにも「議員13人全員が score +1.000」というセルがある（care_harm × 子ども・将来世代 など）。
  // そこに差を作るのは捏造なので、分けずに positionsDivided: false を返す。
  const index = {
    ...cellIndex,
    "cellidx:care_harm|自然環境|beneficiary": [
      entry("P00001", "似A", 1, 0.032),
      entry("P00004", "似B", 1, 0.030),
      entry("P00005", "似C", 1, 0.028),
    ],
    "cellidx:care_harm|自然環境|threat": [],
  };
  const { response } = await request("/api/perspectives/energy-2035", createDbMock(), createKvMock(index));
  const data = await response.json();

  assert.equal(data.perspectives[0].positionsDivided, false);
  // 片方の立場しか無いので2人まで。同じ立場を3人並べても対比にならない。
  assert.deepEqual(data.perspectives[0].politicians.map((p) => p.alignment), ["same", "same"]);
});

test("立場が分かれた論点は positionsDivided: true", async () => {
  const { response } = await request("/api/perspectives/energy-2035");
  const data = await response.json();

  assert.equal(data.perspectives[0].positionsDivided, true);
});

test("符号が全員同じでも、近さの差で分ける", async () => {
  // 実データの efficiency_utility × 国民全体 は14人全員が score 正。
  // 符号で分けると片側に寄って、両方の立場を見せる画面にならない。
  const index = {
    ...cellIndex,
    "cellidx:care_harm|自然環境|threat": [],
    "cellidx:care_harm|自然環境|beneficiary": [
      entry("P00001", "強A", 1.0, 0.032),
      entry("P00004", "強B", 1.0, 0.030),
      entry("P00005", "中A", 0.7, 0.028),
      entry("P00006", "弱A", 0.4, 0.026),
    ],
  };
  const { response } = await request("/api/perspectives/energy-2035", createDbMock(), createKvMock(index));
  const data = await response.json();
  const byName = new Map(data.perspectives[0].politicians.map((p) => [p.politicianName, p.alignment]));

  assert.equal(data.perspectives[0].positionsDivided, true);
  // 回答は uphold なので +1.0 が最も近く、+0.4 が最も遠い
  assert.equal(byName.get("弱A"), "different");
  assert.equal([...byName.values()].includes("same"), true);
});

test("同じ条件の議員の中ではランダムに選ぶ", async () => {
  const seen = new Set();
  for (let i = 0; i < 25; i++) {
    const { response } = await request("/api/perspectives/energy-2035");
    const data = await response.json();
    seen.add(data.perspectives[0].politicians.map((p) => p.politicianName).sort().join(","));
  }

  // 似た立場4人から2人、異なる立場2人から1人なので、組み合わせは複数出るはず
  assert.equal(seen.size > 1, true, "毎回同じ顔ぶれになっている");
});

test("自分の回答の文面は返さない", async () => {
  const { response } = await request("/api/perspectives/energy-2035");
  const data = await response.json();

  assert.equal("yourAnswer" in data.perspectives[0], false);
});

test("マッチ度は返さず、その価値をどう扱ったかを文で返す", async () => {
  const { response } = await request("/api/perspectives/energy-2035");
  const data = await response.json();
  const politicians = data.perspectives[0].politicians;
  const uphold = politicians.find((p) => p.score > 0.2);
  const override = politicians.find((p) => p.score < -0.2);

  assert.equal(uphold.stanceText, "被害や苦痛への配慮を根拠として持ち出しています");
  // score が負＝その価値を優先順位で下に置いた。「反対」とは書かない。
  if (override) assert.equal(override.stanceText, "被害や苦痛への配慮よりも他の価値を優先しています");
  assert.match(uphold.mentionText, /%を占めます|倍です|少なめです/);

  assert.equal("match_score" in politicians[0], false);
  assert.equal("matchScore" in politicians[0], false);
});

test("role が違う発言は、score が同じ符号でも「異なる立場」にする", async () => {
  // beneficiary（守る対象）と threat（問題の原因）は設計上「正反対の思想」なので、
  // score の符号が同じでも「似た立場」と出してはいけない
  const index = {
    ...cellIndex,
    "cellidx:care_harm|自然環境|beneficiary": [entry("P00001", "似A", 1, 0.032)],
  };
  const { response } = await request("/api/perspectives/energy-2035", createDbMock(), createKvMock(index));
  const data = await response.json();
  const threat = data.perspectives[0].politicians.find((p) => p.role === "threat");

  assert.equal(threat.score > 0, true);
  assert.equal(threat.alignment, "different");
});

test("「どちらとも言えない」と答えた論点では立場を判定しない", async () => {
  const rows = [[1, "energy-2035_q1", "設問", "neutral", "care_harm", "自然環境", "beneficiary"]];
  const { response } = await request("/api/perspectives/energy-2035", createDbMock(rows));
  const data = await response.json();

  assert.equal(data.perspectives[0].positionsDivided, false);
  assert.equal(data.perspectives[0].politicians.every((p) => p.alignment === "unclear"), true);
  assert.equal(data.perspectives[0].politicians.length, 2);
});

test("国会会議録の発言は原文を返し、公式サイト由来は要約に留める", async () => {
  // P00001 だけを候補にして、その evidence（3件・うち1件は公式サイト由来）を見る
  const index = { ...cellIndex, "cellidx:care_harm|自然環境|beneficiary": [entry("P00001", "似A", 0.91, 0.032)], "cellidx:care_harm|自然環境|threat": [] };
  const { response } = await request("/api/perspectives/energy-2035", createDbMock(), createKvMock(index));
  const data = await response.json();
  const statements = data.perspectives[0].politicians[0].statements;

  // evidence にある分はすべて返す（1セルにつき最大3件）
  assert.equal(statements.length, 3);

  assert.equal(statements[0].quotable, true);
  assert.equal(statements[0].excerpt, "景観と生態系を守ることが第一であります。");
  assert.equal(statements[0].url, "https://kokkai.ndl.go.jp/txt/1/1");

  // quote が無い＝著作物。原文は出さない。
  assert.equal(statements[1].quotable, false);
  assert.equal(statements[1].excerpt, null);
  assert.equal(statements[1].summary, "自然環境への配慮を訴えた");
});

test("evidence は選んだ議員の分だけ読む（候補を全員読まない）", async () => {
  const { response, kv } = await request("/api/perspectives/energy-2035");
  const data = await response.json();

  const evidenceReads = kv.reads.filter((key) => key.startsWith("profile:evidence:"));
  const shown = new Set(data.perspectives.flatMap((p) => p.politicians.map((x) => x.speakerId)));

  // 候補は7人いるが、読むのは表示する議員の分だけ（論点をまたぐ重複は除く）
  assert.equal(evidenceReads.length, shown.size);
  assert.equal(evidenceReads.length <= 4, true, `evidence を ${evidenceReads.length} 件読んでいる`);
  // マッチ計算用の profile:{id} は読まない（cellidx だけで議員名・党名まで出せる）
  assert.equal(kv.reads.some((key) => /^profile:P\d+$/.test(key)), false);
});

test("発言を出せない議員はカードに出さない", async () => {
  const { response } = await request("/api/perspectives/energy-2035", createDbMock(), createKvMock(cellIndex, {}));
  const data = await response.json();

  assert.deepEqual(data.perspectives.map((p) => p.politicians.length), [0, 0]);
});

test("意見が保存されていない記事は404", async () => {
  const { response } = await request("/api/perspectives/unknown", createDbMock([]));

  assert.equal(response.status, 404);
});
