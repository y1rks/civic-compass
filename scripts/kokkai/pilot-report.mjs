// パイロット結果を目視確認用の Markdown に整形する。
//
// 見るべきなのは精度の数値ではなく、
//   1. 思想が対極の議員で frame 分布に差が出ているか（出ないなら抽出が効いていない）
//   2. override が拾えているか（出現率が低いので落としやすい）
//   3. 原文にない引用（not_found）が出ていないか（＝推論でタグを付けていないか）
// の3点。

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { FRAMES } from "./llm.mjs";

const FRAME_JA = {
  care_harm: "ケア・被害",
  fairness: "公正・互恵",
  liberty_autonomy: "自由・自己決定",
  loyalty_community: "共同体・絆",
  authority_order: "権威・秩序",
  sanctity_tradition: "伝統・尊厳",
  efficiency_utility: "効率・実利",
  procedure_rule_of_law: "手続き・法の支配",
  sovereignty: "主権・自立",
  evidence_expertise: "科学・専門知",
};

const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
const pct = (a, b) => (b === 0 ? "—" : `${((a / b) * 100).toFixed(0)}%`);

export async function renderReport({ utterances, outcomes, samples, outDir }) {
  const allFrames = utterances.flatMap((u) => u.justification_frames);
  const rejected = utterances.flatMap((u) => u.rejected_frames);
  const byPolitician = new Map();
  for (const u of utterances) {
    if (!byPolitician.has(u.politician_name)) byPolitician.set(u.politician_name, []);
    byPolitician.get(u.politician_name).push(u);
  }

  const L = [];
  L.push("# 抽出パイロット（実装順1）\n");
  L.push(`ブロック ${samples.length} / セグメント ${utterances.length} / フレーム ${allFrames.length}\n`);

  // --- 1. 健全性チェック -----------------------------------------------------
  L.push("## 1. 健全性チェック\n");
  const noValue = utterances.filter((u) => u.no_value_content).length;
  const matchCount = count([...allFrames, ...rejected].map((f) => f.evidence_match));
  L.push("| 指標 | 値 | 見方 |");
  L.push("|---|---:|---|");
  L.push(`| 価値含意なし | ${noValue} / ${utterances.length}（${pct(noValue, utterances.length)}） | 高すぎるなら抽出が慎重すぎる |`);
  L.push(`| 引用が原文と厳密一致 | ${matchCount.get("exact") ?? 0} | 多いほどよい |`);
  L.push(`| 引用が表記ゆれで一致 | ${matchCount.get("normalized") ?? 0} | 許容範囲 |`);
  L.push(`| **引用が原文になく破棄** | **${matchCount.get("not_found") ?? 0}** | **推論でタグを付けた件数。0が理想** |`);
  L.push(`| 1セグメントあたりのフレーム数 | ${(allFrames.length / Math.max(utterances.length, 1)).toFixed(1)} | 極端に多いと付けすぎ |`);
  const failed = outcomes.filter((o) => o.error).length;
  if (failed > 0) L.push(`| API失敗 | ${failed} | |`);
  L.push("");

  const stance = count(allFrames.map((f) => f.stance));
  L.push("### stance の分布\n");
  L.push("| stance | 件数 | 割合 |");
  L.push("|---|---:|---:|");
  for (const s of ["uphold", "override", "neutral"]) {
    L.push(`| \`${s}\` | ${stance.get(s) ?? 0} | ${pct(stance.get(s) ?? 0, allFrames.length)} |`);
  }
  L.push("");
  L.push("`override` が 0 なら、プロンプトの例が効いていないので見直しが必要です。\n");

  // --- 2. 議員ごとの frame 分布（最重要） ------------------------------------
  L.push("## 2. 議員ごとの frame 分布\n");
  L.push("**似た分布が並んだら抽出が効いていません。**思想が対極の議員で差が出るかを見ます。\n");
  const names = [...byPolitician.keys()];
  L.push(`| フレーム | ${names.join(" | ")} |`);
  L.push(`|---|${names.map(() => "---:").join("|")}|`);
  for (const f of FRAMES) {
    const cells = names.map((n) => {
      const us = byPolitician.get(n);
      const fs = us.flatMap((u) => u.justification_frames);
      const c = fs.filter((x) => x.frame === f).length;
      return c === 0 ? "·" : `${c} (${pct(c, fs.length)})`;
    });
    if (cells.every((c) => c === "·")) continue;
    L.push(`| ${FRAME_JA[f]} | ${cells.join(" | ")} |`);
  }
  L.push("");

  // --- 3. target × role -----------------------------------------------------
  L.push("## 3. target × role の分布\n");
  const cells = count(
    allFrames.flatMap((f) => (f.targets ?? []).map((t) => `${t.entity}|${t.role}`)),
  );
  const threats = [...cells].filter(([k]) => k.endsWith("|threat")).sort((a, b) => b[1] - a[1]);
  L.push("上位10件:\n");
  L.push("| target | role | 件数 |");
  L.push("|---|---|---:|");
  for (const [k, c] of [...cells].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    const [entity, role] = k.split("|");
    L.push(`| ${entity} | \`${role}\` | ${c} |`);
  }
  L.push("");
  L.push(`\`threat\` として語られた対象: ${threats.length ? threats.map(([k, c]) => `${k.split("|")[0]}(${c})`).join(" / ") : "なし"}\n`);
  L.push("`threat` が全く出ないと、正反対の思想が同じセルに畳まれてしまいます。\n");

  // --- 4. 破棄された引用 -----------------------------------------------------
  if (rejected.length > 0) {
    L.push("## 4. 破棄されたフレーム（原文に引用が見つからなかったもの）\n");
    L.push("推論でタグを付けた疑いがあるものです。プロンプトの改善材料になります。\n");
    for (const f of rejected.slice(0, 15)) {
      L.push(`- \`${f.frame}\` / ${f.stance} — 引用: 「${f.evidence_text}」`);
    }
    L.push("");
  }

  // --- 5. 個別サンプル -------------------------------------------------------
  L.push("## 5. 個別サンプル（目視確認用）\n");
  for (const [name, us] of byPolitician) {
    L.push(`### ${name}\n`);
    for (const u of us.slice(0, 4)) {
      L.push(`<details><summary><b>${u.date ?? "日付不明"} ${u.speech_type} / ${u.answer_context}</b> — ${u.summary}</summary>\n`);
      L.push("> " + u.quote.replace(/\n/g, "\n> ").slice(0, 900) + "\n");
      if (u.no_value_content) {
        L.push("**価値含意なしと判定**\n");
      } else {
        L.push("| frame | stance | 強さ | target | 根拠にした箇所 |");
        L.push("|---|---|---:|---|---|");
        for (const f of u.justification_frames) {
          const tg = (f.targets ?? []).map((t) => `${t.entity}/${t.role}`).join("<br>");
          const mark = f.evidence_match === "exact" ? "" : " ⚠";
          L.push(`| ${FRAME_JA[f.frame]} | \`${f.stance}\` | ${f.intensity} | ${tg} | 「${f.evidence_text}」${mark} |`);
        }
        L.push(`\n確信度 ${u.confidence}\n`);
      }
      L.push("</details>\n");
    }
  }

  await writeFile(path.join(outDir, "report.md"), L.join("\n"), "utf8");
}
