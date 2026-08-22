#!/usr/bin/env node
// 本番のフレーム抽出。data/clean/*.jsonl → data/utterances.jsonl
//
//   node scripts/kokkai/extract-batch.mjs [--limit-per-politician=500] [--concurrency=12]
//                                         [--only=P00001,P00012] [--dry-run]
//
// 17時間級の長時間実行になるので、次の3つを前提に作ってある。
//   1. 途中で止まる ── 処理済みは出力ファイルから復元してスキップする（何度でも再開できる）
//   2. レート制限に当たる ── Workers AI は約26リクエスト/分。待って再試行する
//   3. あとから対象を増やす ── 上限を上げて再実行すれば、未処理分だけが流れる
//
// 対象は「重み付き（answer_context の重み）の高い順」に選ぶ。
// 議員あたりの上限で切っても、党首討論や自発的発言といった質の高いものが残る。

import { readFile, writeFile, appendFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runStructured, EXTRACT_SCHEMA, SEGMENT_SCHEMA, DEFAULT_MODEL } from "./workers-ai.mjs";
import { alignSegments, alignEvidence } from "./align.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "data/utterances.jsonl");
const PROGRESS = path.join(ROOT, "data/extract-progress.json");

const MIN_SEGMENT_CHARS = 100;
const EXTRACT_VERSION = "extract-v1.0-glm";
const SEGMENTATION_VERSION = "seg-v1.0-glm";

function parseArgs(argv) {
  const args = { limit: 500, concurrency: 12, only: null, dryRun: false, model: DEFAULT_MODEL };
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--limit-per-politician=")) args.limit = Number(a.slice(23));
    else if (a.startsWith("--concurrency=")) args.concurrency = Number(a.slice(14));
    else if (a.startsWith("--only=")) args.only = a.slice(7).split(",").map((s) => s.trim());
    else if (a.startsWith("--model=")) args.model = a.slice(8);
    else throw new Error(`不明な引数: ${a}`);
  }
  return args;
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** すでに抽出済みの block_id を出力ファイルから復元する（途中再開のため） */
async function loadDone() {
  if (!(await exists(OUT))) return new Set();
  const done = new Set();
  const text = await readFile(OUT, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      done.add(JSON.parse(line).source.block_id);
    } catch {
      // 書き込み途中で切れた行は無視する（次回また処理される）
    }
  }
  return done;
}

/**
 * 抽出対象を選ぶ。議員ごとに「重みの高い順 → 新しい順」で上限まで。
 * 上限を上げて再実行したとき、既存分の順序が変わらないよう決定的に並べる。
 */
async function selectTargets(master, args) {
  const targets = [];
  for (const p of master.politicians) {
    if (p.active === false) continue;
    if (args.only && !args.only.includes(p.speaker_id)) continue;

    const file = path.join(ROOT, `data/clean/${p.speaker_id}.jsonl`);
    if (!(await exists(file))) continue;

    const rows = (await readFile(file, "utf8"))
      .split("\n").filter(Boolean).map((l) => JSON.parse(l))
      .filter((r) => !r.excluded_reason);

    rows.sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;          // 質の高い発言を優先
      const ad = a.date ?? "", bd = b.date ?? "";
      if (ad !== bd) return bd.localeCompare(ad);                      // 新しい順
      return a.block_id.localeCompare(b.block_id);                     // 決定的に
    });

    targets.push(...rows.slice(0, args.limit));
  }
  return targets;
}

/** 1ブロックを分割 → 各セグメントを抽出 */
async function processBlock(block, prompts, model) {
  const split = await runStructured({
    model,
    system: prompts.segment,
    user: `以下の発言を分割してください。\n\n---\n${block.text}\n---`,
    schema: SEGMENT_SCHEMA,
    maxTokens: 1500,
  });

  const { segments } = alignSegments(block.text, (split.segments ?? []).map((s) => s.head));
  const out = [];

  for (const [i, seg] of segments.entries()) {
    const segText = block.text.slice(seg.char_range[0], seg.char_range[1]).trim();
    if (segText.length < MIN_SEGMENT_CHARS) continue;

    const ex = await runStructured({
      model,
      system: prompts.extract,
      user: `以下の発言から正当化フレームを抽出してください。\n\n---\n${segText}\n---`,
      schema: EXTRACT_SCHEMA,
    });

    const frames = alignEvidence(segText, seg.char_range[0], ex.justification_frames ?? []);
    const kept = frames.filter((f) => f.kept).map(({ kept: _k, ...f }) => f);
    const rejected = frames.filter((f) => !f.kept).map(({ kept: _k, ...f }) => f);

    const isWholeBlock = seg.char_range[0] === 0 && seg.char_range[1] >= block.text.length;

    out.push({
      utterance_id: `${block.block_id}_seg${String(i).padStart(2, "0")}`,
      source: { ...block.source, block_id: block.block_id, segment_index: i, char_range: seg.char_range },
      speaker_id: block.speaker_id,
      politician_name: block.politician_name,
      source_kind: block.source_kind,
      date: block.date,
      speech_type: block.speech_type,
      answer_context: block.answer_context,
      weight: block.weight,
      position_at_time: block.position_at_time,
      party_at_time: block.party_at_time,
      extract_version: EXTRACT_VERSION,
      segmentation_version: SEGMENTATION_VERSION,
      no_value_content: ex.no_value_content || kept.length === 0,
      justification_frames: kept,
      rejected_frames: rejected,
      summary: ex.summary,
      quote: segText,
      block_text: isWholeBlock ? null : block.text,
      quotable: block.quotable,
      confidence: ex.confidence,
    });
  }

  return out;
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}時間${m}分` : `${m}分${s % 60}秒`;
}

async function main() {
  const args = parseArgs(process.argv);
  const master = JSON.parse(await readFile(path.join(ROOT, "scripts/kokkai/politicians.json"), "utf8"));
  const [segment, extract] = await Promise.all([
    readFile(path.join(ROOT, "scripts/kokkai/prompts/segment.md"), "utf8"),
    readFile(path.join(ROOT, "scripts/kokkai/prompts/extract.md"), "utf8"),
  ]);

  await mkdir(path.dirname(OUT), { recursive: true });

  const all = await selectTargets(master, args);
  const done = await loadDone();
  const todo = all.filter((b) => !done.has(b.block_id));

  const byPolitician = {};
  for (const b of all) byPolitician[b.politician_name] = (byPolitician[b.politician_name] ?? 0) + 1;

  console.log(`モデル      ${args.model}`);
  console.log(`議員あたり  最大${args.limit}ブロック`);
  console.log(`対象        ${all.length}ブロック（処理済み ${done.size} / 残り ${todo.length}）`);
  console.log(`内訳        ${Object.entries(byPolitician).map(([k, v]) => `${k}${v}`).join(" / ")}`);
  // 実測 約26リクエスト/分。1ブロックあたり 分割1 + 抽出n回
  const estMin = Math.round((todo.length * 2.6) / 26);
  console.log(`所要見込み  約${fmtDuration(estMin * 60_000)}（レート制限 約26req/分が律速）\n`);

  if (args.dryRun) {
    console.log("--dry-run のため実行しません");
    return;
  }
  if (todo.length === 0) {
    console.log("すべて処理済みです");
    return;
  }

  const started = Date.now();
  let ok = 0;
  let fail = 0;
  let segCount = 0;
  let next = 0;
  const failures = [];

  const worker = async () => {
    while (next < todo.length) {
      const block = todo[next++];
      try {
        const utterances = await processBlock(block, { segment, extract }, args.model);
        // 1ブロックごとに追記する。途中で落ちても、そこまでは残る
        if (utterances.length > 0) {
          await appendFile(OUT, utterances.map((u) => JSON.stringify(u)).join("\n") + "\n", "utf8");
          segCount += utterances.length;
        }
        ok++;
      } catch (e) {
        fail++;
        failures.push({ block_id: block.block_id, error: String(e.message).slice(0, 160) });
      }

      const finished = ok + fail;
      if (finished % 10 === 0 || finished === todo.length) {
        const elapsed = Date.now() - started;
        const remain = (elapsed / finished) * (todo.length - finished);
        process.stdout.write(
          `  ${finished}/${todo.length}  成功${ok} 失敗${fail}  ${segCount}セグメント  ` +
            `経過${fmtDuration(elapsed)} 残り約${fmtDuration(remain)}          \r`,
        );
        await writeFile(
          PROGRESS,
          JSON.stringify({ updated_at: new Date().toISOString(), total: todo.length, ok, fail, segments: segCount, failures: failures.slice(-50) }, null, 2),
          "utf8",
        );
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(args.concurrency, todo.length) }, worker));

  console.log(`\n\n完了  成功${ok} 失敗${fail}  ${segCount}セグメント  ${fmtDuration(Date.now() - started)}`);
  console.log(`出力  data/utterances.jsonl`);
  if (fail > 0) {
    console.log(`\n失敗したブロックは再実行すれば処理されます（処理済みはスキップされます）`);
    console.log(`失敗の記録: data/extract-progress.json`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
