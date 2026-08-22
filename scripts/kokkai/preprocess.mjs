#!/usr/bin/env node
// data/raw/*.jsonl（APIの生レスポンス）を、LLMの segment 分割・抽出にかけられる形に整える。
//
//   node scripts/kokkai/preprocess.mjs [--only=P00001,P00007]
//
// 出力は data/clean/{speaker_id}.jsonl。
// 除外したブロックも excluded_reason 付きで残す。取りこぼしの監査に必要なため捨てない。
//
// ここでやること（すべて機械的処理。LLM は使わない）
//   1. 発言者名プレフィックス（"○＜氏名＞君　" 等）の除去
//   2. 改行と行頭の全角スペース（レイアウト用インデント）の正規化
//   3. 短い発言・議事進行の定型文の除外マーキング
//   4. speech_type / party_at_time / position_at_time の機械的な付与
//
// ★ char_range / evidence_span の基準は、ここで出力する text（正規化後）とする。
//    プレフィックスを除いた分の位置ずれを追えるように prefix_removed を残している。

import { mkdir, readFile, writeFile, readdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RAW_DIR = path.join(ROOT, "data/raw");
const RAW_WEB_DIR = path.join(ROOT, "data/raw_web");
const MANUAL_DIR = path.join(ROOT, "data/manual");
const CLEAN_DIR = path.join(ROOT, "data/clean");

const MIN_CHARS = 200; // これ未満は抽出に値しない（docs/design-constraints.md「A のパイプライン」①機械的フィルタ）

// "○＜氏名＞君　" / "○国務大臣（＜氏名＞君）　" / "○＜姓＞参考人　" などを剥がす。
// プレフィックス内に全角スペースは現れないので、行頭○から最初の全角スペースまでを対象にする。
const SPEAKER_PREFIX = /^○[^　\r\n]{1,60}　/;

// speakerPosition がこれらに該当すると、その発言は官僚が用意した統一見解＝政府答弁とみなす。
const GOVERNMENT_POSITION = /大臣|長官|次官|政府特別補佐人|内閣官房副長官/;

// 委員長・主査としての議事進行。本人の価値観ではないので除外する。
const CHAIR_POSITION = /委員長|主査|議長/;

// 答弁の「本人度」は会議の種類で大きく変わる。実データで定型表現率を測って決めた重み。
//
//   党首討論     定型2.3%  … 原稿なしの応酬。一人称の価値表明が多く、質疑と同等に扱える
//   予算委答弁   定型7.0%  … 所管外の質問が飛ぶため想定問答を外れやすい
//   各省委員会   定型10-24% … 議員差が大きい（同じ答弁でも3.4%〜23.9%の幅がある）
//   本会議答弁   定型81.3% … 施政方針・趣旨説明。完全に官僚作成なので抽出しない
//
// 詳細は scripts/kokkai/README.md を参照。
const ANSWER_WEIGHT = {
  spontaneous: 1.0, // 自発的発言（質問する側）
  party_leader_debate: 1.0, // 党首討論
  budget_committee_answer: 0.5,
  ministry_committee_answer: 0.3,
  plenary_answer: 0, // 抽出対象外
};

// 200字以上あっても中身が議事進行でしかない定型文。
const PROCEDURAL_PATTERNS = [
  /^これより会議を開きます/,
  /^本日の会議を開きます/,
  /御異議ありませんか.*御異議なしと認めます/s,
  /^次に、?[^\n]{0,40}君。$/,
];

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

function parseArgs(argv) {
  const args = { only: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--only=")) args.only = a.slice(7).split(",").map((s) => s.trim());
    else throw new Error(`不明な引数: ${a}`);
  }
  return args;
}

/** 発言本文からレイアウト由来のノイズを取り除く。戻り値の text が以後の位置基準になる */
function normalizeSpeech(raw) {
  const prefixMatch = raw.match(SPEAKER_PREFIX);
  const prefix = prefixMatch ? prefixMatch[0] : null;
  let text = prefix ? raw.slice(prefix.length) : raw;

  text = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^　+/, "")) // 段落頭のインデント
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, prefix };
}

function classifySpeechType(rec) {
  if (rec.speakerPosition && GOVERNMENT_POSITION.test(rec.speakerPosition)) return "政府答弁";
  if (rec.nameOfMeeting === "本会議") return "本会議";
  return "国会質疑";
}

/** 答弁がどれだけ本人の言葉かを、会議の種類から判定する */
function classifyAnswerContext(rec, speechType) {
  if (speechType !== "政府答弁") return "spontaneous";
  if (rec.nameOfMeeting?.includes("国家基本政策委員会")) return "party_leader_debate";
  if (rec.nameOfMeeting === "本会議") return "plenary_answer";
  if (rec.nameOfMeeting?.startsWith("予算委員会")) return "budget_committee_answer";
  return "ministry_committee_answer";
}

function decideExclusion(rec, text, answerContext) {
  if (rec.speakerRole && /政府参考人/.test(rec.speakerRole)) return "government_official";
  if (rec.speakerPosition && CHAIR_POSITION.test(rec.speakerPosition)) return "chair_procedural";
  if (rec.speakerRole && CHAIR_POSITION.test(rec.speakerRole)) return "chair_procedural";
  // 発言者名プレフィックスに「委員長」が入るケース。speakerPosition が null でもここで拾える
  if (/^○[^　]{0,20}(委員長|議長|主査)　/.test(rec.speech)) return "chair_procedural";
  if (text.length < MIN_CHARS) return "too_short";
  if (PROCEDURAL_PATTERNS.some((re) => re.test(text))) return "procedural";
  // 本会議での大臣答弁＝施政方針演説・法案の趣旨説明。官僚作成なので抽出しない
  if (answerContext === "plenary_answer") return "plenary_government_statement";
  return null;
}

// ---------------------------------------------------------------------------
// 公式サイト・手動投入テキスト
//
// 国会会議録が「発言ブロック」なのに対し、こちらは「文書」なので見出しで区切る。
// LLM による segment 分割の前段として、機械的に読める構造だけ先に使っておく。
// ---------------------------------------------------------------------------

const MAX_SECTION_CHARS = 900; // segment の目安（200〜800字）に合わせた上限

/** Markdown の見出しで区切る。短すぎるセクションは直前につなげる */
function splitByHeading(text) {
  const sections = [];
  let current = { heading: null, body: [] };

  for (const line of text.split("\n")) {
    const m = /^#{1,6}\s+(.+)$/.exec(line);
    if (m) {
      if (current.heading || current.body.length > 0) sections.push(current);
      current = { heading: m[1].trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  sections.push(current);

  const out = [];
  for (const s of sections) {
    const body = [s.heading, s.body.join("\n").trim()].filter(Boolean).join("\n").trim();
    if (!body) continue;
    if (out.length > 0 && body.length < MIN_CHARS) out[out.length - 1].text += "\n" + body;
    else out.push({ heading: s.heading, text: body });
  }
  return out;
}

/**
 * 見出しのないプレーンテキストを、切れ目を保ったまま一定の長さに刻む。
 * HTML から抽出したテキストは空行が落ちていることが多いので、
 * 段落が取れないときは行単位でまとめる。
 */
function splitByParagraph(text) {
  let units = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  // 空行がなく1塊のままなら行単位に切り替える
  if (units.length <= 1) units = text.split("\n").map((s) => s.trim()).filter(Boolean);

  const out = [];
  let buf = [];
  let len = 0;
  const flush = () => {
    if (len > 0) out.push({ heading: null, text: buf.join("\n").trim() });
    buf = [];
    len = 0;
  };
  for (const u of units) {
    if (len > 0 && len + u.length > MAX_SECTION_CHARS) flush();
    buf.push(u);
    len += u.length;
  }
  flush();
  return out;
}

// 議事録を転載しているページには、答弁した大臣や政府参考人の発言が混ざる。
// そのまま集計すると他人の価値観が本人のプロファイルに入ってしまうので取り除く。
// （同姓の別人の別人が混入しているケースを除外）
const SPEAKER_MARKER = /○([^\s]{1,40}?)[\s]/g;

/** 本人以外の発言を落とす。マーカーに本人のフルネームが無いブロックを捨てる */
function stripOtherSpeakers(text, politicianName) {
  const marks = [...text.matchAll(SPEAKER_MARKER)];
  if (marks.length === 0) return { text, removed: 0 };

  const kept = [];
  let removed = 0;

  // 最初のマーカーより前は本人の発言とみなす（記事は本人の発言から始まる想定）
  if (marks[0].index > 0) kept.push(text.slice(0, marks[0].index));

  for (const [i, m] of marks.entries()) {
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    // 姓だけの一致だと同姓の別人を通してしまうので、フルネームで判定する
    if (m[1].includes(politicianName)) kept.push(text.slice(m.index + m[0].length, end));
    else removed++;
  }

  return { text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(), removed };
}

/** 公式サイトから取得した1ページ、または手動投入テキストを clean レコードに変換する */
function webDocToRecords(doc, politician, index) {
  // URL に日付が入っていれば発言日として使う（日付をパスに持つ政策ブログなど）
  const m = /\/(20\d\d)\/(\d{2})(?:\/(\d{2}))?\//.exec(doc.url ?? "");
  const date = m ? `${m[1]}-${m[2]}-${m[3] ?? "01"}` : null;

  const { text: ownText, removed } = stripOtherSpeakers(doc.text, politician.name);
  const hasHeadings = /^#{1,6}\s+/m.test(ownText);
  const sections = hasHeadings ? splitByHeading(ownText) : splitByParagraph(ownText);

  return sections.map((sec, i) => ({
    block_id: `${politician.speaker_id}_${doc.source_kind}${index.toString().padStart(3, "0")}_s${i.toString().padStart(2, "0")}`,
    speaker_id: politician.speaker_id,
    politician_name: politician.name,
    source_kind: doc.source_kind, // "web" | "manual"

    source: {
      url: doc.url,
      site_label: doc.site_label,
      title: doc.title,
      section: sec.heading,
    },

    // 日付が読めないページは「現在の主張」として扱う。extract_window の判定にも使う
    date,
    date_is_unknown: date === null,

    speech_type: "選挙公約",
    answer_context: "spontaneous",
    weight: ANSWER_WEIGHT.spontaneous,
    party_at_time: politician.party,
    position_at_time: null,
    speaker_role: null,

    text: sec.text,
    char_length: sec.text.length,
    prefix_removed: null,

    // 公式サイト由来は著作物。evidence で原文引用せず要約＋リンクで扱う（§10）
    quotable: false,
    // 議事録転載ページから他人の発言を落とした件数（0 でなければ元ページが議事録）
    other_speakers_removed: removed,

    excluded_reason: sec.text.length < MIN_CHARS ? "too_short" : null,
  }));
}

function toCleanRecord(rec, politician) {
  const { text, prefix } = normalizeSpeech(rec.speech);
  const speechType = classifySpeechType(rec);
  const answerContext = classifyAnswerContext(rec, speechType);

  return {
    block_id: `${politician.speaker_id}_${rec.speechID}`,
    speaker_id: politician.speaker_id,
    politician_name: politician.name,
    source_kind: "kokkai",

    source: {
      meeting_id: rec.issueID,
      speech_id: rec.speechID,
      speech_index: rec.speechOrder,
      url: rec.speechURL,
      meeting_url: rec.meetingURL,
    },

    date: rec.date,
    session: rec.session,
    house: rec.nameOfHouse,
    meeting: rec.nameOfMeeting,
    issue: rec.issue,

    speech_type: speechType,
    // 答弁の「本人度」。集計時の重み付けに使う（ANSWER_WEIGHT 参照）
    answer_context: answerContext,
    weight: ANSWER_WEIGHT[answerContext],
    // 発言時点の会派・役職。API が返す値をそのまま使い、LLM には推測させない。
    party_at_time: rec.speakerGroup,
    position_at_time: rec.speakerPosition,
    speaker_role: rec.speakerRole, // "参考人" など。speech_type に畳まず生で残す

    text,
    char_length: text.length,
    prefix_removed: prefix,

    // 国会会議録は公文書なので evidence に原文を引用できる
    quotable: true,

    excluded_reason: decideExclusion(rec, text, answerContext),
  };
}

async function readIfExists(p) {
  try {
    await access(p);
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

/** 公式サイト（data/raw_web）と手動投入（data/manual）を読んで clean レコードにする */
async function loadWebRecords(politician) {
  const out = [];

  const webRaw = await readIfExists(path.join(RAW_WEB_DIR, `${politician.speaker_id}.jsonl`));
  if (webRaw) {
    for (const [i, line] of webRaw.split("\n").filter(Boolean).entries()) {
      out.push(...webDocToRecords(JSON.parse(line), politician, i));
    }
  }

  // 手動投入。robots.txt で取得しないサイトや、SPA で本文が取れないサイトの受け皿。
  const manual = await readIfExists(path.join(MANUAL_DIR, `${politician.speaker_id}.md`));
  if (manual) {
    out.push(
      ...webDocToRecords(
        {
          source_kind: "manual",
          url: politician.website,
          site_label: "公式サイト（手動投入）",
          title: null,
          text: manual,
        },
        politician,
        0,
      ),
    );
  }

  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const master = JSON.parse(await readFile(path.join(ROOT, "scripts/kokkai/politicians.json"), "utf8"));
  await mkdir(CLEAN_DIR, { recursive: true });
  const window = master.extract_window;

  const available = new Set(
    (await readdir(RAW_DIR)).filter((f) => f.endsWith(".jsonl")).map((f) => f.replace(".jsonl", "")),
  );
  const targets = master.politicians.filter(
    (p) => available.has(p.speaker_id) && (!args.only || args.only.includes(p.speaker_id)),
  );
  if (targets.length === 0) throw new Error("処理対象がありません。先に collect.mjs を実行してください");

  const report = [];

  for (const p of targets) {
    const lines = (await readFile(path.join(RAW_DIR, `${p.speaker_id}.jsonl`), "utf8")).split("\n").filter(Boolean);
    const records = lines.map((l) => toCleanRecord(JSON.parse(l), p));
    records.push(...(await loadWebRecords(p)));

    // 抽出に使う期間を全議員で揃える。日付が読めない文書（政策ページ等）は現在の主張として残す。
    const from = p.extract_from ?? window.from;
    const to = p.extract_to ?? window.to;
    for (const r of records) {
      if (r.excluded_reason || r.date_is_unknown) continue;
      if (r.date < from || r.date > to) r.excluded_reason = "out_of_window";
    }

    await writeFile(
      path.join(CLEAN_DIR, `${p.speaker_id}.jsonl`),
      records.map((r) => JSON.stringify(r)).join("\n") + "\n",
      "utf8",
    );

    const kept = records.filter((r) => !r.excluded_reason);
    const kokkai = kept.filter((r) => r.source_kind === "kokkai");
    const web = kept.filter((r) => r.source_kind !== "kokkai");
    const byContext = (ctx) => kokkai.filter((r) => r.answer_context === ctx).length;
    const reasons = {};
    for (const r of records) if (r.excluded_reason) reasons[r.excluded_reason] = (reasons[r.excluded_reason] ?? 0) + 1;

    const dates = kokkai.map((r) => r.date).sort();

    report.push({
      speaker_id: p.speaker_id,
      name: p.name,
      party: p.party,
      // 現職でなくなった議員。データは残すが、プロファイル構築とマッチ候補からは外す
      active: p.active !== false,
      inactive_reason: p.inactive_reason ?? null,
      n_raw: records.length,
      n_kept: kept.length,
      excluded: reasons,
      kokkai: {
        n: kokkai.length,
        // 重み付きの実効的なデータ量。単純な件数より議員間の比較に使える
        weighted_n: Math.round(sum(kokkai.map((r) => r.weight)) * 10) / 10,
        chars: sum(kokkai.map((r) => r.char_length)),
        by_answer_context: {
          spontaneous: byContext("spontaneous"),
          party_leader_debate: byContext("party_leader_debate"),
          budget_committee_answer: byContext("budget_committee_answer"),
          ministry_committee_answer: byContext("ministry_committee_answer"),
        },
        date_range: dates.length ? [dates[0], dates.at(-1)] : null,
      },
      web: {
        n: web.length,
        chars: sum(web.map((r) => r.char_length)),
        by_kind: {
          web: web.filter((r) => r.source_kind === "web").length,
          manual: web.filter((r) => r.source_kind === "manual").length,
        },
      },
    });
  }

  await writeFile(path.join(ROOT, "data/preprocess-report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");

  const pad = (s, n) => String(s).padEnd(n, " ");
  const w = (name) => 12 - (name.length - [...name].length);
  console.log(
    [pad("", 5), pad("議員", 12), pad("自発", 6), pad("党首", 6), pad("予算委", 7), pad("各省委", 7), pad("重み付n", 8), pad("国会字数", 11), pad("web", 5), "web字数"].join(""),
  );
  for (const r of report) {
    const c = r.kokkai.by_answer_context;
    console.log(
      [
        pad(r.active ? r.speaker_id.slice(-3) : "×" + r.speaker_id.slice(-3), 5),
        pad(r.name, w(r.name)),
        pad(c.spontaneous, 6),
        pad(c.party_leader_debate, 6),
        pad(c.budget_committee_answer, 7),
        pad(c.ministry_committee_answer, 7),
        pad(r.kokkai.weighted_n, 8),
        pad(r.kokkai.chars.toLocaleString(), 11),
        pad(r.web.n, 5),
        r.web.chars.toLocaleString(),
      ].join(""),
    );
  }
  const act = report.filter((r) => r.active);
  console.log(
    `\n現職 ${act.length}人 / データのみ保持（現職でない）${report.length - act.length}人  ※ × 印は現職でない議員`,
  );
  console.log(
    `合計（現職のみ）: 生 ${sum(act.map((r) => r.n_raw))} / 抽出対象 ${sum(act.map((r) => r.n_kept))}` +
      `（国会 ${sum(act.map((r) => r.kokkai.n))} + web/手動 ${sum(act.map((r) => r.web.n))}）` +
      ` / 国会の重み付き ${Math.round(sum(act.map((r) => r.kokkai.weighted_n)))}`,
  );
  console.log(`詳細: data/preprocess-report.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
