#!/usr/bin/env node
// 議員・政党の公式サイトから、政策・理念を述べたページの本文を取得する。
//
//   node scripts/kokkai/fetch-web.mjs [--target=politicians|parties] [--only=P00002] [--force]
//
// 出力は data/raw_web/{id}.jsonl（議員は speaker_id、政党は party_id）。
// 国会会議録と違い、こちらは著作物なので【1】utterances でも quote を表示用には使わない。
// 集計・表示では要約＋出典URLで扱う（docs/design-constraints.md「著作権」）。
//
// robots.txt でAIクローラーを拒否しているサイトは取得しない（web-fetch-lib.mjs 参照）。
// その場合は data/manual/{speaker_id}.md に手でテキストを置けば merge-manual.mjs が取り込む。

import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { parse } from "node-html-parser";
import { fetchPolite, isAllowed } from "./web-fetch-lib.mjs";
import { ROOT, loadMaster, parseTarget } from "./masters.mjs";

const OUT_DIR = path.join(ROOT, "data/raw_web");

const MAX_FOLLOW = 30; // 1つの一覧ページから辿る記事数の上限
const MIN_CHARS = 200; // 国会データと同じ足切り

// 本文ではない部分。落としてからテキスト化する
const DROP_SELECTOR = "script,style,nav,header,footer,aside,form,noscript,iframe,svg,button";
// 本文が入っていそうな領域。上から順に試す
const MAIN_SELECTORS = ["article", "main", "#main", ".entry-content", ".post-content", "#content", ".content"];

// 政党サイトは一覧ページの配下が深く、議員サイトより辿る先が多い。
const MAX_FOLLOW_PARTY = 60;

function parseArgs(argv) {
  const args = { target: "politicians", only: null, force: false };
  for (const a of argv.slice(2)) {
    if (a === "--force") args.force = true;
    else if (a.startsWith("--target=")) args.target = parseTarget(a.slice(9));
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

/**
 * 一覧ページから記事のリンクを集める。日付を含むパスか、一覧ページ配下のものを記事とみなす。
 *
 * `followDated: false` は政党サイト向け。政党の一覧ページからは日付付きのお知らせ
 * （街頭演説の告知、公認候補の発表）が大量に出てきて、そのほとんどが価値含意なしになる。
 * 公約を読みたいだけなので、一覧ページの配下だけを辿る。
 */
function findArticleLinks(html, baseUrl, { maxFollow = MAX_FOLLOW, followDated = true } = {}) {
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
    const isDated = followDated
      && (/\/\d{4}\/\d{2}\//.test(u.pathname) || /\/\d{4,}\/?$/.test(u.pathname));
    const isChild = u.pathname.startsWith(base.pathname) && u.pathname !== base.pathname;
    if (isDated || isChild) out.add(u.href);
  }
  return [...out].slice(0, maxFollow);
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
  const master = await loadMaster(args.target);
  await mkdir(OUT_DIR, { recursive: true });

  const targets = master.entries.filter((e) => !args.only || args.only.includes(e.id));

  for (const p of targets) {
    const outPath = path.join(OUT_DIR, `${p.id}.jsonl`);
    if (!args.force && (await exists(outPath))) {
      console.log(`skip  ${p.id} ${p.name}（既存。取り直すなら --force）`);
      continue;
    }
    if (!p.web_sources || p.web_sources.length === 0) {
      console.log(`--    ${p.id} ${p.name}: web_sources なし${p.web_note ? `（${p.web_note}）` : ""}`);
      continue;
    }

    console.log(`fetch ${p.id} ${p.name}`);
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
            doc_id: `${p.id}_web_${docs.length.toString().padStart(3, "0")}`,
            // ★政党でも列名は speaker_id / politician_name のままにする。
            //   後段（preprocess → utterances → D1）が同じ経路を通るため。
            //   政党のときは speaker_id が party_id、politician_name が党名になる。
            speaker_id: p.id,
            politician_name: p.name,
            entity_kind: master.kind, // politician | party
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
          const isParty = master.kind === "party";
          const options = { maxFollow: isParty ? MAX_FOLLOW_PARTY : MAX_FOLLOW, followDated: !isParty };
          for (const link of findArticleLinks(html, url, options)) {
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
