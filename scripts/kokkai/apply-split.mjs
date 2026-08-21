#!/usr/bin/env node
// data/pilot/split.json の分割指定を blocks.jsonl に適用して segments.jsonl を作る。
//
//   node scripts/kokkai/apply-split.mjs
//
// LLM API を使わずに抽出を試すとき用（分割は人または Claude Code が判断し、
// 位置の特定と検証だけをここでやる）。split.json に無いブロックは1セグメント扱い。

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { alignSegments } from "./align.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(ROOT, "data/pilot");

const blocks = (await readFile(path.join(DIR, "blocks.jsonl"), "utf8"))
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));
const split = JSON.parse(await readFile(path.join(DIR, "split.json"), "utf8"));

const segments = [];
const warnings = [];

for (const [index, block] of blocks.entries()) {
  const heads = split[String(index)];
  const ranges = heads
    ? alignSegments(block.text, heads)
    : { segments: [{ char_range: [0, block.text.length], head_match: "whole" }], dropped: [] };

  if (ranges.dropped.length > 0) {
    warnings.push(`[${index}] 原文に見つからない冒頭: ${ranges.dropped.join(" / ")}`);
  }
  if (heads && ranges.segments.length !== heads.length) {
    warnings.push(`[${index}] 指定 ${heads.length} に対し ${ranges.segments.length} セグメント`);
  }

  for (const [i, seg] of ranges.segments.entries()) {
    const text = block.text.slice(seg.char_range[0], seg.char_range[1]).trim();
    if (text.length < 100) {
      warnings.push(`[${index}] seg${i} が ${text.length}字と短いため除外`);
      continue;
    }
    segments.push({
      segment_id: `${block.block_id}_seg${String(i).padStart(2, "0")}`,
      block_index: index,
      block_id: block.block_id,
      speaker_id: block.speaker_id,
      politician_name: block.politician_name,
      source_kind: block.source_kind,
      source: { ...block.source, segment_index: i, char_range: seg.char_range },
      date: block.date,
      speech_type: block.speech_type,
      answer_context: block.answer_context,
      weight: block.weight,
      position_at_time: block.position_at_time,
      party_at_time: block.party_at_time,
      quotable: block.quotable,
      head_match: seg.head_match,
      text,
      char_length: text.length,
    });
  }
}

await writeFile(path.join(DIR, "segments.jsonl"), segments.map((s) => JSON.stringify(s)).join("\n") + "\n", "utf8");

const byP = {};
for (const s of segments) byP[s.politician_name] = (byP[s.politician_name] ?? 0) + 1;
console.log(`${blocks.length} ブロック → ${segments.length} セグメント`);
console.log(`  ${Object.entries(byP).map(([k, v]) => `${k}${v}`).join(" / ")}`);
console.log(`  平均 ${Math.round(segments.reduce((a, s) => a + s.char_length, 0) / segments.length)} 字`);
if (warnings.length) {
  console.log("\n警告:");
  for (const w of warnings) console.log(`  ${w}`);
} else {
  console.log("\n分割指定はすべて原文と一致しました");
}
