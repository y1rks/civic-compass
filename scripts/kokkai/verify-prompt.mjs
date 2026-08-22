#!/usr/bin/env node
// 抽出プロンプトの few-shot 例が自己矛盾していないか確かめる。
//
//   node scripts/kokkai/verify-prompt.mjs
//
// 「evidence_text は原文からの一字一句の引用」と指示しておきながら、
// 例のほうが入力に存在しない文字列だと、LLM に矛盾したことを教えることになる。
// プロンプトを直したら毎回これを通す。

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FRAMES, TARGETS, STANCES, ROLES } from "./llm.mjs";
import { locate } from "./align.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const text = await readFile(path.join(HERE, "prompts/extract.md"), "utf8");

// 「入力:」直後のコードブロックと、「出力:」直後の JSON を対にして取り出す
const pairs = [...text.matchAll(/入力:\n```\n([\s\S]*?)\n```[\s\S]*?出力:\n```json\n([\s\S]*?)\n```/g)];

let ng = 0;
let checked = 0;

for (const [i, m] of pairs.entries()) {
  const input = m[1];
  let parsed;
  try {
    parsed = JSON.parse(m[2]);
  } catch (e) {
    console.log(`例${i + 1}: 出力JSONが壊れています — ${e.message}`);
    ng++;
    continue;
  }

  for (const f of parsed.justification_frames ?? []) {
    checked++;
    const problems = [];

    // 語彙が定義どおりか
    if (!FRAMES.includes(f.frame)) problems.push(`未定義のframe: ${f.frame}`);
    if (!STANCES.includes(f.stance)) problems.push(`未定義のstance: ${f.stance}`);
    for (const t of f.targets ?? []) {
      if (!TARGETS.includes(t.entity)) problems.push(`未定義のtarget: ${t.entity}`);
      if (!ROLES.includes(t.role)) problems.push(`未定義のrole: ${t.role}`);
    }

    // 引用が入力に実在するか（これが本題）
    const { match } = locate(input, f.evidence_text ?? "");
    if (match === "not_found") problems.push(`引用が入力に存在しない`);
    else if (match === "normalized") problems.push(`引用が入力と厳密一致しない（表記ゆれ）`);

    // 指示した長さの範囲に収まっているか
    const len = (f.evidence_text ?? "").length;
    if (len < 40) problems.push(`evidence_textが${len}字（指示は40字以上）`);
    if (len > 150) problems.push(`evidence_textが${len}字（指示は150字以下）`);

    if (problems.length > 0) {
      ng++;
      console.log(`例${i + 1} / ${f.frame}:`);
      for (const p of problems) console.log(`    ✗ ${p}`);
      console.log(`    「${(f.evidence_text ?? "").slice(0, 60)}…」`);
    }
  }
}

console.log(`\n例 ${pairs.length}件 / フレーム ${checked}件 を検査`);
console.log(ng === 0 ? "矛盾なし" : `${ng}件の問題`);
process.exit(ng === 0 ? 0 : 1);
