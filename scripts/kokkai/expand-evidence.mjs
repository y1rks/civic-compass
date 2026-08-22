#!/usr/bin/env node
// evidence_text を、文として完結する長さまで前後に広げる。
//
//   node scripts/kokkai/expand-evidence.mjs
//
// 抜き出しが短すぎると、あとから根拠を検証できない（「これは日本の国益を守る上でも」だけでは
// 何が国益を守るのか分からない）。原文上の位置は分かっているので、
// 前後の文境界まで機械的に広げる。原文からの引用であることは変わらない。

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(ROOT, "data/pilot");

const MIN_CHARS = 40; // これ未満なら広げる
const MAX_CHARS = 200; // 広げすぎない上限

/** 文の切れ目。行頭・行末も境界として扱う */
const isBoundary = (c) => c === "。" || c === "\n";

/**
 * text 内の [start, end) を、文として完結する範囲まで広げる。
 * 前方は直前の文境界の次から、後方は次の文境界まで。
 */
function expand(text, start, end) {
  let s = start;
  let e = end;

  // 後方：次の「。」まで（無ければ行末／末尾）
  while (e < text.length && !isBoundary(text[e])) e++;
  if (e < text.length && text[e] === "。") e++;

  // 前方：直前の「。」の次まで
  while (s > 0 && !isBoundary(text[s - 1])) s--;

  // まだ短ければ、その前の文も足す
  while (e - s < MIN_CHARS && s > 0) {
    let prev = s - 1;
    if (isBoundary(text[prev])) prev--;
    while (prev > 0 && !isBoundary(text[prev - 1])) prev--;
    if (prev === s) break;
    if (end - prev > MAX_CHARS) break;
    s = prev;
  }

  // 上限を超えたら削るが、**元の抜き出しは必ず含める**。
  // ここを間違えると、根拠にした箇所が evidence から消えてしまう。
  if (e - s > MAX_CHARS) {
    const need = end - start;
    if (need >= MAX_CHARS) {
      s = start;
      e = end;
    } else {
      const margin = MAX_CHARS - need;
      s = Math.max(s, start - Math.floor(margin / 2));
      e = Math.min(e, end + Math.ceil(margin / 2));
    }
  }

  return [s, e];
}

const load = async (f) =>
  (await readFile(path.join(DIR, f), "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));

const segments = new Map((await load("segments.jsonl")).map((s) => [s.segment_id, s]));
const extracted = await load("extracted.jsonl");

let expanded = 0;
let unchanged = 0;
const samples = [];

for (const ex of extracted) {
  const seg = segments.get(ex.segment_id);
  for (const f of ex.justification_frames ?? []) {
    const idx = seg.text.indexOf(f.evidence_text);
    if (idx < 0) continue; // 照合できないものは触らない
    if (f.evidence_text.length >= MIN_CHARS) {
      unchanged++;
      continue;
    }
    const [s, e] = expand(seg.text, idx, idx + f.evidence_text.length);
    const next = seg.text.slice(s, e).trim();
    if (next.length > f.evidence_text.length) {
      if (samples.length < 6) samples.push([f.evidence_text, next]);
      f.evidence_text = next;
      expanded++;
    }
  }
}

await writeFile(path.join(DIR, "extracted.jsonl"), extracted.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");

const all = extracted.flatMap((e) => e.justification_frames ?? []);
const lens = all.map((f) => f.evidence_text.length);
console.log(`広げた ${expanded}件 / そのまま ${unchanged}件`);
console.log(`平均 ${Math.round(lens.reduce((a, b) => a + b, 0) / lens.length)}字 / 最短 ${Math.min(...lens)}字 / 最長 ${Math.max(...lens)}字`);
console.log("\n例:");
for (const [before, after] of samples) {
  console.log(`  前: 「${before}」`);
  console.log(`  後: 「${after}」\n`);
}
