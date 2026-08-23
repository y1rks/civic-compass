#!/usr/bin/env node
// 公式サイトのトップページから、政策・理念を述べているページのリンクを探す。
//
//   node scripts/kokkai/discover-web.mjs [--target=politicians|parties] [--only=PT01]
//
// 結果を見て politicians.json / parties.json の web_sources を手で確定させるための補助ツール。
// サイト構造は対象ごとにバラバラなので、自動判定に任せきりにはしない。

import { parse } from "node-html-parser";
import { fetchPolite, isAllowed } from "./web-fetch-lib.mjs";
import { loadMaster, parseTarget } from "./masters.mjs";

// リンク文字列がこれにあたれば、政策・理念を述べたページの候補とみなす
const POLICY_LINK = /政策|理念|考え|主張|公約|マニフェスト|ビジョン|めざす|目指す|想い|信念|訴え|綱領|基本政策|重点/;

function parseArgs(argv) {
  const args = { target: "politicians", only: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--target=")) args.target = parseTarget(a.slice(9));
    else if (a.startsWith("--only=")) args.only = a.slice(7).split(",").map((s) => s.trim());
    else throw new Error(`不明な引数: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const master = await loadMaster(args.target);

  for (const entry of master.entries) {
    if (args.only && !args.only.includes(entry.id)) continue;
    const top = entry.website;
    if (!top) {
      console.log(`${entry.id} ${entry.name}: website 未設定`);
      continue;
    }

    const allowed = await isAllowed(top);
    if (!allowed.ok) {
      console.log(`${entry.id} ${entry.name}: [robots.txt により取得しません] ${allowed.reason}`);
      continue;
    }

    let html;
    try {
      html = await fetchPolite(top);
    } catch (e) {
      console.log(`${entry.id} ${entry.name}: 取得失敗 ${e.message}`);
      continue;
    }

    const root = parse(html);
    const found = new Map();
    for (const a of root.querySelectorAll("a")) {
      const label = a.text.replace(/\s+/g, " ").trim();
      const href = a.getAttribute("href");
      if (!href || !label || label.length > 30 || !POLICY_LINK.test(label)) continue;
      let u;
      try {
        u = new URL(href, top);
      } catch {
        continue;
      }
      if (u.hostname !== new URL(top).hostname) continue;
      u.hash = "";
      if (!found.has(u.href)) found.set(u.href, label);
    }

    console.log(`${entry.id} ${entry.name}  候補${found.size}件`);
    for (const [u, label] of [...found].slice(0, 10)) console.log(`    ${label}  ->  ${u}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
