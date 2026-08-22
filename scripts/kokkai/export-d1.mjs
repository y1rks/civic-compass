#!/usr/bin/env node
// utterances.jsonl を D1 に投入できる SQL に変換する。
//
//   node scripts/kokkai/export-d1.mjs [--in=data/pilot/utterances.jsonl] [--out=data/pilot/utterances.sql]
//
// 政党の公約も同じ表に入れます（entity_kind = 'party'）。
//   node scripts/kokkai/export-d1.mjs --in=data/utterances-party.jsonl --out=data/utterances-party.sql
// ★このとき --truncate を付けないこと。議員の抽出結果まで消えます。
//
// 適用:
//   wrangler d1 execute civic-compass-db --local  --file=data/pilot/utterances.sql   # ローカル
//   wrangler d1 execute civic-compass-db --remote --file=data/pilot/utterances.sql   # 本番
//
// D1 は1回の execute に上限があるので、INSERT はバッチに分けて出力します。
// 【1】は追記のみ・書き換え禁止なので INSERT OR IGNORE にし、再実行しても壊れないようにします。
//
// ⚠️ INSERT OR IGNORE は「既存の utterance_id を更新しない」ということでもあります。
// 抽出をやり直したり repair-evidence.mjs で evidence_text を直したりしたあとは、
// 古い行が残り続けてしまうので `--truncate` を付けて入れ直してください。
// （INSERT OR REPLACE にしない理由: utterance_frames が utterances を外部キー参照して
//   いるため、REPLACE = DELETE + INSERT で子テーブルとの整合が壊れる）

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// 1 INSERT 文あたりの上限。quote / block_text が長いので行数ではなくバイト数で切ります。
// 行数で切ると SQLITE_TOOBIG になります（D1 は1文の長さに制限があります）。
const MAX_STATEMENT_BYTES = 60_000;

function parseArgs(argv) {
  const args = { in: "data/pilot/utterances.jsonl", out: "data/pilot/utterances.sql", truncate: false };
  for (const a of argv.slice(2)) {
    if (a === "--truncate") args.truncate = true;
    else if (a.startsWith("--in=")) args.in = a.slice(5);
    else if (a.startsWith("--out=")) args.out = a.slice(6);
    else throw new Error(`不明な引数: ${a}`);
  }
  return args;
}

/** SQLite のリテラルにする。NULL と数値以外はシングルクォートをエスケープして文字列に */
function lit(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
}

function insertStatements(table, columns, rows) {
  const head = `INSERT OR IGNORE INTO ${table}\n  (${columns.join(", ")})\nVALUES\n`;
  const headBytes = Buffer.byteLength(head, "utf8");

  const out = [];
  let buf = [];
  let bytes = headBytes;

  const flush = () => {
    if (buf.length > 0) out.push(head + buf.join(",\n") + ";");
    buf = [];
    bytes = headBytes;
  };

  for (const r of rows) {
    const line = `  (${columns.map((c) => lit(r[c])).join(", ")})`;
    const size = Buffer.byteLength(line, "utf8") + 2;
    // 1行だけで上限を超える場合は、その行を単独の文にするしかない
    if (buf.length > 0 && bytes + size > MAX_STATEMENT_BYTES) flush();
    buf.push(line);
    bytes += size;
  }
  flush();
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const utterances = (await readFile(path.join(ROOT, args.in), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const uRows = [];
  const fRows = [];
  const tRows = [];

  for (const u of utterances) {
    uRows.push({
      utterance_id: u.utterance_id,
      speaker_id: u.speaker_id,
      politician_name: u.politician_name,
      // 政党の公約から作ったレコードを見分けるための列。既存データは politician。
      entity_kind: u.entity_kind ?? "politician",
      source_kind: u.source_kind,
      meeting_id: u.source.meeting_id ?? null,
      speech_id: u.source.speech_id ?? null,
      speech_index: u.source.speech_index ?? null,
      segment_index: u.source.segment_index,
      char_range_start: u.source.char_range[0],
      char_range_end: u.source.char_range[1],
      url: u.source.url ?? null,
      date: u.date ?? null,
      speech_type: u.speech_type,
      answer_context: u.answer_context,
      weight: u.weight,
      position_at_time: u.position_at_time ?? null,
      party_at_time: u.party_at_time ?? null,
      extract_version: u.extract_version,
      segmentation_version: u.segmentation_version,
      no_value_content: u.no_value_content,
      summary: u.summary ?? null,
      confidence: u.confidence ?? null,
      quote: u.quote,
      block_text: u.block_text ?? null,
      quotable: u.quotable,
      rejected_frames: u.rejected_frames?.length ? JSON.stringify(u.rejected_frames) : null,
    });

    for (const [i, f] of (u.justification_frames ?? []).entries()) {
      const frameId = `${u.utterance_id}_f${String(i).padStart(2, "0")}`;
      fRows.push({
        frame_id: frameId,
        utterance_id: u.utterance_id,
        speaker_id: u.speaker_id,
        frame: f.frame,
        stance: f.stance,
        intensity: f.intensity,
        evidence_text: f.evidence_text,
        evidence_span_start: f.evidence_span?.[0] ?? null,
        evidence_span_end: f.evidence_span?.[1] ?? null,
        evidence_match: f.evidence_match,
      });
      // 同じ (entity, role) が重複することがあるので潰す（主キーが3列のため）
      const seen = new Set();
      for (const t of f.targets ?? []) {
        const key = `${t.entity}|${t.role}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tRows.push({ frame_id: frameId, entity: t.entity, role: t.role });
      }
    }
  }

  // 入れ直すときは先に空にする。子テーブルから順に消さないと外部キーに引っかかる
  const truncate = args.truncate
    ? [
        "-- --truncate 指定のため、既存データを削除してから入れ直します",
        "DELETE FROM utterance_frame_targets;",
        "DELETE FROM utterance_frames;",
        "DELETE FROM utterances;",
        "",
      ]
    : [];

  const sql = [
    "-- 【1】utterances。追記のみ・書き換え禁止。",
    "-- 再実行しても壊れないよう INSERT OR IGNORE にしています。",
    `-- 生成元: ${args.in}`,
    "",
    ...truncate,
    ...insertStatements(
      "utterances",
      Object.keys(uRows[0]),
      uRows,
    ),
    "",
    ...insertStatements("utterance_frames", Object.keys(fRows[0]), fRows),
    "",
    ...insertStatements("utterance_frame_targets", Object.keys(tRows[0]), tRows),
    "",
  ].join("\n");

  await writeFile(path.join(ROOT, args.out), sql, "utf8");

  console.log(`${args.out} を書き出しました`);
  console.log(`  utterances              ${uRows.length} 行`);
  console.log(`  utterance_frames        ${fRows.length} 行`);
  console.log(`  utterance_frame_targets ${tRows.length} 行`);
  console.log(`  SQL ${(sql.length / 1024).toFixed(0)}KB`);
  if (args.truncate) console.log("  先頭に DELETE を入れました（既存データを置き換えます）");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
