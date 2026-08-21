#!/usr/bin/env node
// 実装順1: segment分割 + 抽出プロンプトを50件で試し、frame の付き方を目視確認する。
//
//   node scripts/kokkai/pilot.mjs [--n=50] [--concurrency=4]
//
// 出力
//   data/pilot/utterances.jsonl … 抽出結果（【1】utterances と同じ形）
//   data/pilot/report.md        … 原文と抽出結果を並べた目視確認用のレポート
//
// このパイロットで見るのは「frame が妥当に付いているか」であって精度の数値ではない。
// 思想が対極の議員で似た分布が出たら、抽出が効いていないので先に進まないこと。

import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { splitIntoSegments, extractFrames, MODEL } from "./llm.mjs";
import { alignSegments, alignEvidence } from "./align.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "data/pilot");

// 思想が対極になる組み合わせと、答弁/質疑/web の全パターンを含むように選ぶ。
const PLAN = [
  { id: "P00001", n: 10, note: "党首討論・予算委答弁・手動投入" },
  { id: "P00012", n: 10, note: "共産・質疑" },
  { id: "P00017", n: 8, note: "いのちの党・質疑・web" },
  { id: "P00014", n: 8, note: "参政党・質疑・web" },
  { id: "P00002", n: 7, note: "自民・各省委答弁" },
  { id: "P00004", n: 7, note: "自民非閣僚・質疑" },
];

function parseArgs(argv) {
  const args = { n: null, concurrency: 4 };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--n=")) args.n = Number(a.slice(4));
    else if (a.startsWith("--concurrency=")) args.concurrency = Number(a.slice(14));
    else throw new Error(`不明な引数: ${a}`);
  }
  return args;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** 決定的に散らばったサンプルを取る（等間隔なので実行するたび同じ50件になる） */
export function spread(rows, n) {
  if (rows.length <= n) return rows;
  const step = rows.length / n;
  return Array.from({ length: n }, (_, i) => rows[Math.floor(i * step)]);
}

export async function pickSamples(scale = 1) {
  const picked = [];
  for (const p of PLAN) {
    const rows = (await readFile(path.join(ROOT, `data/clean/${p.id}.jsonl`), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((r) => !r.excluded_reason && r.char_length >= 250);

    // 発言の種類が偏らないよう、answer_context ごとに配分する
    const groups = {};
    for (const r of rows) (groups[`${r.source_kind}:${r.answer_context}`] ??= []).push(r);
    const keys = Object.keys(groups).sort();
    const want = Math.max(1, Math.round(p.n * scale));
    // 切り捨てると総数が目標を下回るので、多めに取ってから最後に絞る
    const per = Math.max(1, Math.ceil(want / keys.length));

    const take = [];
    for (const k of keys) take.push(...spread(groups[k], per));
    picked.push(...spread(take, want));
  }
  return picked;
}

async function processBlock(block) {
  const { heads, usage: segUsage } = await splitIntoSegments(block.text);
  const { segments, dropped } = alignSegments(block.text, heads);

  const results = [];
  for (const [i, seg] of segments.entries()) {
    const segText = block.text.slice(seg.char_range[0], seg.char_range[1]).trim();
    if (segText.length < 100) continue; // 分割の失敗で出た断片は抽出にかけない

    // 分割していない（segment がブロック全体）なら block_text は持たない。quote と同じ文字列になるため。
    // 原文は LLM に出力させず、ここでコピーする（1文字でも変わると evidence_span がずれるため）。
    const isWholeBlock = seg.char_range[0] === 0 && seg.char_range[1] >= block.text.length;

    const { extracted, usage } = await extractFrames(segText);
    const frames = alignEvidence(segText, seg.char_range[0], extracted.justification_frames ?? []);

    results.push({
      utterance_id: `${block.block_id}_seg${String(i).padStart(2, "0")}`,
      source: {
        ...block.source,
        segment_index: i,
        char_range: seg.char_range,
      },
      speaker_id: block.speaker_id,
      politician_name: block.politician_name,
      source_kind: block.source_kind,
      date: block.date,
      speech_type: block.speech_type,
      answer_context: block.answer_context,
      weight: block.weight,
      position_at_time: block.position_at_time,
      party_at_time: block.party_at_time,

      extract_version: "extract-v1.0",
      segmentation_version: "seg-v1.0",

      no_value_content: extracted.no_value_content || frames.filter((f) => f.kept).length === 0,
      justification_frames: frames.filter((f) => f.kept).map(({ kept, ...f }) => f),
      rejected_frames: frames.filter((f) => !f.kept).map(({ kept, ...f }) => f),

      summary: extracted.summary,
      quote: segText,
      // 分割前のブロック全文。分割していない場合は quote と同じなので null。
      // クライアントは `block_text ?? quote` で常に発言ブロック全文を得られる。
      block_text: isWholeBlock ? null : block.text,
      quotable: block.quotable,
      confidence: extracted.confidence,

      _head_match: seg.head_match,
      _usage: { segment: segUsage, extract: usage },
    });
  }

  return { results, dropped, n_segments: segments.length };
}

async function main() {
  const args = parseArgs(process.argv);
  await mkdir(OUT_DIR, { recursive: true });

  const total = PLAN.reduce((a, p) => a + p.n, 0);
  const scale = args.n ? args.n / total : 1;
  const samples = await pickSamples(scale);

  console.log(`モデル: ${MODEL}`);
  console.log(`サンプル: ${samples.length} ブロック / 並列 ${args.concurrency}`);
  console.log("分割 → 抽出を実行します（1ブロックあたり数秒）\n");

  let done = 0;
  const started = Date.now();
  const outcomes = await mapLimit(samples, args.concurrency, async (block) => {
    try {
      const r = await processBlock(block);
      done++;
      const elapsed = ((Date.now() - started) / 1000).toFixed(0);
      console.log(`  [${done}/${samples.length}] ${block.politician_name} ${block.block_id} → ${r.results.length}セグメント (${elapsed}秒)`);
      return r;
    } catch (e) {
      done++;
      console.error(`  [${done}/${samples.length}] ${block.block_id} 失敗: ${e.message}`);
      return { results: [], dropped: [], n_segments: 0, error: e.message };
    }
  });

  const utterances = outcomes.flatMap((o) => o.results);
  await writeFile(
    path.join(OUT_DIR, "utterances.jsonl"),
    utterances.map((u) => JSON.stringify(u)).join("\n") + "\n",
    "utf8",
  );

  const { renderReport } = await import("./pilot-report.mjs");
  await renderReport({ utterances, outcomes, samples, outDir: OUT_DIR });

  console.log(`\n抽出: ${utterances.length} セグメント`);
  console.log(`出力: data/pilot/utterances.jsonl / data/pilot/report.md`);
}

// 直接実行されたときだけ走らせる。dump-samples.mjs など他から import しても
// main() が動かないようにするため。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
