#!/usr/bin/env node
// 各議員の公式サイトのトップページから、政策・理念を述べているページのリンクを探す。
//
//   node scripts/kokkai/discover-web.mjs
//
// 結果を見て politicians.json の web_sources を手で確定させるための補助ツール。
// サイト構造は議員ごとにバラバラなので、自動判定に任せきりにはしない。

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "node-html-parser";
import { fetchPolite, isAllowed } from "./web-fetch-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// リンク文字列がこれにあたれば、政策・理念を述べたページの候補とみなす
const POLICY_LINK = /政策|理念|考え|主張|公約|マニフェスト|ビジョン|めざす|目指す|想い|信念|訴え/;

async function main() {
  const master = JSON.parse(await readFile(path.join(ROOT, "scripts/kokkai/politicians.json"), "utf8"));

  for (const p of master.politicians) {
    const top = p.website;
    if (!top) {
      console.log(`${p.speaker_id} ${p.name}: website 未設定`);
      continue;
    }

    const allowed = await isAllowed(top);
    if (!allowed.ok) {
      console.log(`${p.speaker_id} ${p.name}: [robots.txt により取得しません] ${allowed.reason}`);
      continue;
    }

    let html;
    try {
      html = await fetchPolite(top);
    } catch (e) {
      console.log(`${p.speaker_id} ${p.name}: 取得失敗 ${e.message}`);
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

    console.log(`${p.speaker_id} ${p.name}  候補${found.size}件`);
    for (const [u, label] of [...found].slice(0, 8)) console.log(`    ${label}  ->  ${u}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
