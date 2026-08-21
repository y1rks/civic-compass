#!/usr/bin/env node
// 国会会議録検索システム API から対象議員の発言ブロックを収集する。
//
//   node scripts/kokkai/collect.mjs [--only=P00001,P00007] [--force] [--until=2026-08-22]
//
// 出力は data/raw/{speaker_id}.jsonl（APIレスポンスの speechRecord をそのまま1行1件）。
// ここでは一切加工しない。加工は preprocess.mjs が担当する。
//
// API仕様上の注意（https://kokkai.ndl.go.jp/api.html）
//   - maximumRecords は最大100、nextRecordPosition が null になるまでページング
//   - 検索条件に一致する件数が1000を超えるとエラーになるので、期間を再帰的に二分割する
//   - 短時間の大量アクセスは禁止されているのでリクエスト間に必ずウェイトを入れる

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENDPOINT = "https://kokkai.ndl.go.jp/api/speech";
const MAX_RECORDS_PER_QUERY = 1000; // これを超えると API がエラーを返す
const PAGE_SIZE = 100; // maximumRecords の上限
const REQUEST_INTERVAL_MS = 1200; // クロール間隔
const MAX_RETRY = 3;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RAW_DIR = path.join(ROOT, "data/raw");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const args = { only: null, force: false, until: null };
  for (const a of argv.slice(2)) {
    if (a === "--force") args.force = true;
    else if (a.startsWith("--only=")) args.only = a.slice(7).split(",").map((s) => s.trim());
    else if (a.startsWith("--until=")) args.until = a.slice(8);
    else throw new Error(`不明な引数: ${a}`);
  }
  return args;
}

/** YYYY-MM-DD の2点間の中間日を返す */
function midpoint(from, until) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${until}T00:00:00Z`);
  return new Date(a + Math.floor((b - a) / 2)).toISOString().slice(0, 10);
}

function nextDay(date) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

async function request(params) {
  const url = new URL(ENDPOINT);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("recordPacking", "json");

  for (let attempt = 1; ; attempt++) {
    await sleep(REQUEST_INTERVAL_MS);
    let json;
    try {
      const res = await fetch(url, { headers: { "User-Agent": "civic-compass/0.1 (hackathon prototype)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
    } catch (e) {
      if (attempt >= MAX_RETRY) throw e;
      console.warn(`    retry ${attempt}/${MAX_RETRY}: ${e.message}`);
      await sleep(REQUEST_INTERVAL_MS * attempt * 3);
      continue;
    }
    // API はエラーも HTTP 200 + message フィールドで返す
    if (json.message) return { error: String(json.message) };
    return json;
  }
}

/** 件数だけ取得する。1000件超過エラーは Infinity として扱い、呼び出し側に分割させる */
async function countRecords(speaker, from, until) {
  const json = await request({ speaker, from, until, maximumRecords: 1 });
  if (json.error) {
    if (json.error.includes("1000")) return Infinity;
    throw new Error(`API error (${speaker} ${from}..${until}): ${json.error}`);
  }
  return json.numberOfRecords ?? 0;
}

/** 期間内の全レコードを取得する。1000件を超える期間は二分割して再帰する */
async function collectRange(speaker, from, until, records, depth = 0) {
  const n = await countRecords(speaker, from, until);
  if (n === 0) return;

  if (n > MAX_RECORDS_PER_QUERY) {
    const mid = midpoint(from, until);
    if (mid <= from || mid >= until) {
      // 1日で1000件超という異常。取れる分だけ取って警告する
      console.warn(`    [warn] ${from} の1日で ${n} 件。先頭 ${MAX_RECORDS_PER_QUERY} 件のみ取得します`);
    } else {
      console.log(`    ${"  ".repeat(depth)}split ${from}..${until} (${n}件)`);
      await collectRange(speaker, from, mid, records, depth + 1);
      await collectRange(speaker, nextDay(mid), until, records, depth + 1);
      return;
    }
  }

  let startRecord = 1;
  while (startRecord) {
    const json = await request({ speaker, from, until, maximumRecords: PAGE_SIZE, startRecord });
    if (json.error) throw new Error(`API error (${speaker} ${from}..${until}): ${json.error}`);
    for (const rec of json.speechRecord ?? []) records.set(rec.speechID, rec);
    startRecord = json.nextRecordPosition ?? 0;
  }
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const master = JSON.parse(await readFile(path.join(ROOT, "scripts/kokkai/politicians.json"), "utf8"));
  const until = args.until ?? master.until;
  await mkdir(RAW_DIR, { recursive: true });

  const targets = master.politicians.filter((p) => !args.only || args.only.includes(p.speaker_id));
  if (targets.length === 0) throw new Error("対象議員が0人です（--only の指定を確認してください）");

  for (const p of targets) {
    const outPath = path.join(RAW_DIR, `${p.speaker_id}.jsonl`);
    if (!args.force && (await exists(outPath))) {
      console.log(`skip  ${p.speaker_id} ${p.name}（既存。取り直すなら --force）`);
      continue;
    }

    const from = p.collect_from ?? master.default_collect_from;
    console.log(`fetch ${p.speaker_id} ${p.name} ${from}..${until}`);

    const records = new Map(); // speechID -> record（期間分割の境界重複をここで潰す）
    await collectRange(p.name, from, until, records);

    const sorted = [...records.values()].sort((a, b) =>
      a.date === b.date ? a.speechID.localeCompare(b.speechID) : a.date.localeCompare(b.date),
    );

    // 同姓同名の混入チェック。想定会派に前方一致しない会派が出たら警告する
    const groups = new Map();
    for (const r of sorted) groups.set(r.speakerGroup ?? "(なし)", (groups.get(r.speakerGroup ?? "(なし)") ?? 0) + 1);
    const unexpected = [...groups.keys()].filter(
      (g) => g !== "(なし)" && !p.expected_groups.some((e) => g.startsWith(e)),
    );
    if (unexpected.length > 0) {
      console.warn(`    [warn] 想定外の会派: ${unexpected.join(" / ")}（同姓同名の混入の可能性）`);
    }

    await writeFile(outPath, sorted.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    await writeFile(
      path.join(RAW_DIR, `${p.speaker_id}.meta.json`),
      JSON.stringify(
        {
          speaker_id: p.speaker_id,
          name: p.name,
          collected_at: new Date().toISOString(),
          window: { from, until },
          n_records: sorted.length,
          date_range: sorted.length ? [sorted[0].date, sorted.at(-1).date] : null,
          groups: Object.fromEntries([...groups].sort((a, b) => b[1] - a[1])),
          unexpected_groups: unexpected,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    console.log(`      -> ${sorted.length} 件 (${sorted[0]?.date ?? "-"} .. ${sorted.at(-1)?.date ?? "-"})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
