#!/usr/bin/env node
// data/profiles/ を KV に流し込むための bulk JSON を作る。
//
//   node scripts/kokkai/export-kv.mjs
//
// 適用:
//   npx wrangler kv bulk put data/profiles/kv-bulk.json --binding=PROFILES \
//     --config api/wrangler.jsonc --remote
//
// KV のキー設計（docs/data-reference.md）
//   profile:{speaker_id}           議員プロファイル。C のマッチ計算で全件読む
//   profile:evidence:{speaker_id}  evidence。表示する議員の分だけ読む
//   profile:party:{党名}            政党プロファイル
//   cellidx:{frame|target|role}    セル→議員の逆引き。B のポップアップで使う
//
// KV は put で上書きされるので、入れ直しに特別な手当ては要らない。
// ただし閾値変更などで**不要になったキーは残る**ので、
// 抽出をやり直したあとは `wrangler kv bulk delete` で消してから入れ直すこと。

import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(ROOT, "data/profiles");
const OUT = path.join(DIR, "kv-bulk.json");
const KEYS_OUT = path.join(DIR, "kv-keys.json");

// KV の1値あたりの上限は 25MB。超えるものがあれば分割が要るので警告する
const KV_VALUE_LIMIT = 25 * 1024 * 1024;

const entries = [];
const add = (key, value) => entries.push({ key, value: JSON.stringify(value) });

// --- 議員プロファイルと evidence ---
for (const f of (await readdir(DIR)).filter((n) => /^profile_P\d+\.json$/.test(n))) {
  const profile = JSON.parse(await readFile(path.join(DIR, f), "utf8"));
  add(`profile:${profile.speaker_id}`, profile);

  const evPath = path.join(DIR, `evidence/evidence_${profile.speaker_id}.json`);
  add(`profile:evidence:${profile.speaker_id}`, JSON.parse(await readFile(evPath, "utf8")));
}

// --- 政党プロファイル ---
for (const f of await readdir(path.join(DIR, "party"))) {
  const party = JSON.parse(await readFile(path.join(DIR, "party", f), "utf8"));
  add(`profile:party:${party.party}`, party);
}

// --- セル逆引き ---
const manifest = JSON.parse(await readFile(path.join(DIR, "cellidx/_manifest.json"), "utf8"));
for (const m of manifest) {
  add(m.kv_key, JSON.parse(await readFile(path.join(DIR, m.file), "utf8")));
}

await writeFile(OUT, JSON.stringify(entries, null, 2) + "\n", "utf8");
// 入れ直すとき用に、投入したキーの一覧も出しておく
await writeFile(KEYS_OUT, JSON.stringify(entries.map((e) => e.key), null, 2) + "\n", "utf8");

const byPrefix = {};
let total = 0;
let oversize = 0;
for (const e of entries) {
  const p = e.key.startsWith("cellidx:")
    ? "cellidx:"
    : e.key.startsWith("profile:evidence:")
      ? "profile:evidence:"
      : e.key.startsWith("profile:party:")
        ? "profile:party:"
        : "profile:";
  const bytes = Buffer.byteLength(e.value, "utf8");
  byPrefix[p] = (byPrefix[p] ?? 0) + 1;
  total += bytes;
  if (bytes > KV_VALUE_LIMIT) {
    oversize++;
    console.warn(`  [warn] ${e.key} が ${(bytes / 1024 / 1024).toFixed(1)}MB で KV の上限を超えます`);
  }
}

console.log(`${entries.length} キー / 合計 ${(total / 1024 / 1024).toFixed(1)}MB`);
for (const [p, n] of Object.entries(byPrefix)) console.log(`  ${p.padEnd(20)} ${n}`);
if (oversize > 0) console.log(`\n上限超過 ${oversize} 件。分割が必要です`);
console.log(`\n出力  data/profiles/kv-bulk.json`);
console.log(`      data/profiles/kv-keys.json（入れ直すとき削除に使う）`);
