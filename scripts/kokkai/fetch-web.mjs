#!/usr/bin/env node
// 各議員の公式サイトから、政策・理念を述べたページの本文を取得する。
//
//   node scripts/kokkai/fetch-web.mjs [--only=P00002] [--force]
//
// 出力は data/raw_web/{speaker_id}.jsonl。
// 国会会議録と違い、こちらは著作物なので【1】utterances でも quote を表示用には使わない。
// 集計・表示では要約＋出典URLで扱う（docs/design-constraints.md「著作権」）。
//
// robots.txt でAIクローラーを拒否しているサイトは取得しない（web-fetch-lib.mjs 参照）。
// その場合は data/manual/{speaker_id}.md に手でテキストを置けば merge-manual.mjs が取り込む。

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "node-html-parser";
import { fetchPolite, isAllowed } from "./web-fetch-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "data/raw_web");

const MAX_FOLLOW = 30; // 1つの一覧ページから辿る記事数の上限
const MIN_CHARS = 200; // 国会データと同じ足切り

// 本文ではない部分。落としてからテキスト化する
const DROP_SELECTOR = "script,style,nav,header,footer,aside,form,noscript,iframe,svg,button";
// 本文が入っていそうな領域。上から順に試す
const MAIN_SELECTORS = ["article", "main", "#main", ".entry-content", ".post-content", "#content", ".content"];

function parseArgs(argv) {
  const args = { only: null, force: false };
  for (const a of argv.slice(2)) {
    if (a === "--force") args.force = true;
    else if (a.startsWith("--only=")) args.only = a.slice(7).split(",").map((s) => s.trim());
    else throw new Error(`不明な引数: ${a}`);
  }
  return args;
}

function extractText(html) {
  const root = parse(html, { blockTextElements: { script: false, style: false } });
  for (const el of root.querySelectorAll(DROP_SELECTOR)) el.remove();

  let container = null;
  for (const sel of MAIN_SELECTORS) {
    const found = root.querySelectorAll(sel);
    if (found.length === 0) continue;
    // 同じセレクタが複数ある場合は一番長いものを本文とみなす
    container = found.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    if (container.text.trim().length >= MIN_CHARS) break;
    container = null;
  }
  const target = container ?? root.querySelector("body") ?? root;

  const title = root.querySelector("title")?.text?.replace(/\s+/g, " ").trim() ?? null;
  const text = target.text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t　]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, text };
}

// 記事ではないリンク。特に wp-content/uploads は画像・PDFの置き場で、
// 日付を含むパスなので「記事」と誤判定しやすい。
const NOT_ARTICLE = /\.(jpe?g|png|gif|webp|svg|pdf|zip|mp[34]|docx?|xlsx?|pptx?)$/i;
const NOT_ARTICLE_PATH = /\/wp-content\/|\/wp-json\/|\/feed\/?$|\/tag\/|\/author\/|\/page\/\d+/i;

/** 一覧ページから記事のリンクを集める。日付を含むパスか、一覧ページ配下のものを記事とみなす */
function findArticleLinks(html, baseUrl) {
  const root = parse(html);
  const base = new URL(baseUrl);
  const out = new Set();
  for (const a of root.querySelectorAll("a")) {
    const href = a.getAttribute("href");
    if (!href) continue;
    let u;
    try {
      u = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (u.hostname !== base.hostname) continue;
    u.hash = "";
    if (u.href === base.href) continue;
    if (NOT_ARTICLE.test(u.pathname) || NOT_ARTICLE_PATH.test(u.pathname)) continue;
    const isDated = /\/\d{4}\/\d{2}\//.test(u.pathname) || /\/\d{4,}\/?$/.test(u.pathname);
    const isChild = u.pathname.startsWith(base.pathname) && u.pathname !== base.pathname;
    if (isDated || isChild) out.add(u.href);
  }
  return [...out].slice(0, MAX_FOLLOW);
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const master = JSON.parse(await readFile(path.join(ROOT, "scripts/kokkai/politicians.json"), "utf8"));
  await mkdir(OUT_DIR, { recursive: true });

  const targets = master.politicians.filter((p) => !args.only || args.only.includes(p.speaker_id));

  for (const p of targets) {
    const outPath = path.join(OUT_DIR, `${p.speaker_id}.jsonl`);
    if (!args.force && (await exists(outPath))) {
      console.log(`skip  ${p.speaker_id} ${p.name}（既存。取り直すなら --force）`);
      continue;
    }
    if (!p.web_sources || p.web_sources.length === 0) {
      console.log(`--    ${p.speaker_id} ${p.name}: web_sources なし${p.web_note ? `（${p.web_note}）` : ""}`);
      continue;
    }

    console.log(`fetch ${p.speaker_id} ${p.name}`);
    const docs = [];
    const seen = new Set();

    for (const src of p.web_sources) {
      const queue = [{ url: src.url, label: src.label, depth: 0 }];

      while (queue.length > 0) {
        const { url, label, depth } = queue.shift();
        if (seen.has(url)) continue;
        seen.add(url);

        const allowed = await isAllowed(url);
        if (!allowed.ok) {
          console.log(`      [skip] ${url}\n             robots.txt: ${allowed.reason}`);
          continue;
        }

        let html;
        try {
          html = await fetchPolite(url);
        } catch (e) {
          console.log(`      [fail] ${url} ${e.message}`);
          continue;
        }

        const { title, text } = extractText(html);
        if (text.length >= MIN_CHARS) {
          docs.push({
            doc_id: `${p.speaker_id}_web_${docs.length.toString().padStart(3, "0")}`,
            speaker_id: p.speaker_id,
            politician_name: p.name,
            source_kind: "web",
            url,
            site_label: label,
            title,
            text,
            char_length: text.length,
            fetched_at: new Date().toISOString(),
          });
        }

        if (src.follow && depth === 0) {
          for (const link of findArticleLinks(html, url)) {
            if (!seen.has(link)) queue.push({ url: link, label, depth: 1 });
          }
        }
      }
    }

    await writeFile(outPath, docs.map((d) => JSON.stringify(d)).join("\n") + "\n", "utf8");
    const chars = docs.reduce((a, d) => a + d.char_length, 0);
    console.log(`      -> ${docs.length} ページ / ${chars.toLocaleString()} 字`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
