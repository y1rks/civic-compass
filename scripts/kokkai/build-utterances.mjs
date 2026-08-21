#!/usr/bin/env node
// 抽出結果（extracted.jsonl）をセグメント（segments.jsonl）と突き合わせ、
// evidence_text を原文と照合して【1】utterances の形にする。
//
//   node scripts/kokkai/build-utterances.mjs
//
// 原文に見つからない引用は「推論でタグを付けた」ということなので採用しない。
// 捨てずに rejected_frames に残し、プロンプト改善の材料にする。

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { alignEvidence } from "./align.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(ROOT, "data/pilot");

const load = async (f) =>
  (await readFile(path.join(DIR, f), "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));

const segments = new Map((await load("segments.jsonl")).map((s) => [s.segment_id, s]));
const blocks = new Map((await load("blocks.jsonl")).map((b) => [b.block_id, b]));
const extracted = await load("extracted.jsonl");

const utterances = [];
for (const ex of extracted) {
  const seg = segments.get(ex.segment_id);
  if (!seg) throw new Error(`セグメントが見つかりません: ${ex.segment_id}`);
  const block = blocks.get(seg.block_id);
  if (!block) throw new Error(`ブロックが見つかりません: ${seg.block_id}`);

  // 分割していない（segment がブロック全体）なら block_text は持たない。同じ文字列の重複になるため。
  // 分割している場合だけ、切り落とした前後の文脈を見られるように全文を持つ。
  // クライアントは `block_text ?? quote` で常に全文を得られる。
  const [segStart, segEnd] = seg.source.char_range;
  const isWholeBlock = segStart === 0 && segEnd >= block.text.length;

  const frames = alignEvidence(seg.text, seg.source.char_range[0], ex.justification_frames ?? []);
  const kept = frames.filter((f) => f.kept).map(({ kept: _k, ...f }) => f);
  const rejected = frames.filter((f) => !f.kept).map(({ kept: _k, ...f }) => f);

  utterances.push({
    utterance_id: ex.segment_id,
    source: seg.source,
    speaker_id: seg.speaker_id,
    politician_name: seg.politician_name,
    source_kind: seg.source_kind,
    date: seg.date,
    speech_type: seg.speech_type,
    answer_context: seg.answer_context,
    weight: seg.weight,
    position_at_time: seg.position_at_time,
    party_at_time: seg.party_at_time,

    extract_version: "extract-v1.0-manual",
    segmentation_version: "seg-v1.0-manual",

    no_value_content: ex.no_value_content || kept.length === 0,
    justification_frames: kept,
    rejected_frames: rejected,

    summary: ex.summary,
    // この segment の全文。クライアントで根拠箇所をハイライトするときは、
    // evidence_span（元ブロック絶対位置）から source.char_range[0] を引けば quote 内の位置になる。
    quote: seg.text,
    // 分割前のブロック全文。分割していない場合は quote と同じなので null。
    block_text: isWholeBlock ? null : block.text,
    quotable: seg.quotable,
    confidence: ex.confidence,
  });
}

await writeFile(path.join(DIR, "utterances.jsonl"), utterances.map((u) => JSON.stringify(u)).join("\n") + "\n", "utf8");

const all = utterances.flatMap((u) => [...u.justification_frames, ...u.rejected_frames]);
const by = (m) => all.filter((f) => f.evidence_match === m).length;
console.log(`${utterances.length} セグメント / フレーム ${all.length}`);
console.log(`  引用が原文と厳密一致  ${by("exact")}`);
console.log(`  表記ゆれで一致        ${by("normalized")}`);
console.log(`  原文になく破棄        ${by("not_found")}`);
const { renderReport } = await import("./pilot-report.mjs");
await renderReport({
  utterances,
  outcomes: utterances.map(() => ({})),
  samples: new Set(utterances.map((u) => u.source.meeting_id ?? u.utterance_id.split("_seg")[0])),
  outDir: DIR,
});
console.log(`\nレポート: data/pilot/report.md`);

if (by("not_found") > 0) {
  console.log("\n破棄されたもの:");
  for (const u of utterances) {
    for (const f of u.rejected_frames) console.log(`  [${u.politician_name}] ${f.frame}: 「${f.evidence_text}」`);
  }
}
