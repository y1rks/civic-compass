#!/usr/bin/env node
// パイロット対象のブロックを、人（または Claude Code）が読める形に書き出す。
//
//   node scripts/kokkai/dump-samples.mjs
//
// API を使わずに抽出を試すとき用。pilot.mjs と同じサンプルを選ぶので、
// 後から API 版と結果を突き合わせられる。

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickSamples } from "./pilot.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "data/pilot");

const samples = await pickSamples(1);
await mkdir(OUT_DIR, { recursive: true });

await writeFile(
  path.join(OUT_DIR, "blocks.jsonl"),
  samples.map((s) => JSON.stringify(s)).join("\n") + "\n",
  "utf8",
);

// 読みやすい形でも出す（分割作業用）
const md = samples.map((s, i) => {
  const head = `## [${i}] ${s.block_id}\n\n` +
    `- 議員: ${s.politician_name}（${s.party_at_time ?? "-"}）\n` +
    `- 日付: ${s.date ?? "不明"} / ${s.speech_type} / ${s.answer_context}\n` +
    `- 出所: ${s.source_kind}${s.meeting ? ` / ${s.meeting}` : ""}\n` +
    `- 文字数: ${s.char_length}\n`;
  return `${head}\n\`\`\`\n${s.text}\n\`\`\`\n`;
}).join("\n");

await writeFile(path.join(OUT_DIR, "blocks.md"), `# パイロット対象 ${samples.length} ブロック\n\n${md}`, "utf8");

console.log(`${samples.length} ブロックを書き出しました`);
console.log(`  data/pilot/blocks.jsonl（機械用）`);
console.log(`  data/pilot/blocks.md（閲覧用 ${(md.length / 1000).toFixed(0)}k字）`);
const byP = {};
for (const s of samples) byP[s.politician_name] = (byP[s.politician_name] ?? 0) + 1;
console.log(`  内訳: ${Object.entries(byP).map(([k, v]) => `${k}${v}`).join(" / ")}`);
