#!/usr/bin/env node
// 既存の utterances.jsonl で、evidence_text と evidence_span が食い違うものを直す。
//
//   node scripts/kokkai/repair-evidence.mjs [--in=data/utterances.jsonl] [--dry-run]
//
// LLM が原文の改行や括弧を落として evidence_text を返すことがある（実測2.2%）。
// align.mjs の表記ゆれ吸収が位置は正しく特定するので、**位置のほうを信じて
// 原文から切り直す**。align.mjs 側は修正済みなので、これは既存データ用。
//
// ⚠️ 抽出バッチの実行中は使わないこと。
// このスクリプトはファイル全体を読み込んで書き戻すため、その間に extract-batch.mjs が
// 追記した分が失われる。抽出が終わってから1回だけ実行する。
// （extract-batch.mjs は起動時に align.mjs を読み込むので、実行中のプロセスには
//   align.mjs の修正が反映されない。だから完了後の修復が必要になる）

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseArgs(argv) {
  const args = { in: "data/utterances.jsonl", dryRun: false };
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--in=")) args.in = a.slice(5);
    else throw new Error(`不明な引数: ${a}`);
  }
  return args;
}

const args = parseArgs(process.argv);
const file = path.join(ROOT, args.in);

// 抽出バッチが動いていたら止める。読み書きが競合して追記分が失われるため
if (!args.dryRun) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { stdout } = await promisify(execFile)("bash", ["-c", "pgrep -f extract-batch.mjs || true"]);
  if (stdout.trim()) {
    console.error("extract-batch.mjs が実行中です（PID " + stdout.trim().split("\n").join(", ") + "）。");
    console.error("このスクリプトはファイル全体を書き戻すため、抽出中に実行すると追記分が失われます。");
    console.error("抽出の完了を待ってから実行してください（--dry-run なら読むだけなので安全です）。");
    process.exit(1);
  }
}

const rows = (await readFile(file, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));

let fixed = 0;
let unfixable = 0;
const samples = [];

for (const u of rows) {
  // evidence_span は「元ブロック絶対位置」。block_text が無ければ quote がブロック全文
  const full = u.block_text ?? u.quote;
  for (const f of u.justification_frames ?? []) {
    if (!f.evidence_span) continue;
    const [s, e] = f.evidence_span;
    const actual = full.slice(s, e);
    if (actual === f.evidence_text) continue;

    // 長さが大きく違うなら位置がおかしい。触らずに数えるだけにする
    if (Math.abs(actual.length - f.evidence_text.length) > 5) {
      unfixable++;
      continue;
    }
    if (samples.length < 3) samples.push([f.evidence_text, actual]);
    f.evidence_text = actual;
    fixed++;
  }
}

console.log(`${rows.length} セグメントを検査`);
console.log(`  修正   ${fixed}件`);
console.log(`  未修正 ${unfixable}件（位置と長さが大きく食い違うもの。要調査）`);
for (const [before, after] of samples) {
  console.log(`\n  前: ${JSON.stringify(before.slice(0, 60))}`);
  console.log(`  後: ${JSON.stringify(after.slice(0, 60))}`);
}

if (args.dryRun) {
  console.log("\n--dry-run のため書き込みません");
} else if (fixed > 0) {
  await writeFile(file, rows.map((u) => JSON.stringify(u)).join("\n") + "\n", "utf8");
  console.log(`\n${args.in} を更新しました`);
}
