// 議員の公式サイトを取得するための共通処理。robots.txt の確認とクロール間隔。
//
// robots.txt の解釈について
//   このクローラーは civic-compass という独自の User-Agent で動きますが、収集したテキストは
//   LLM に投げてフレーム抽出に使います。つまり用途としては AI クローラーそのものです。
//   そのため `civic-compass` / `*` に加えて **AI クローラー向けの指示にも従います**。
//   独自 UA を名乗れば AI クローラー向けの Disallow を回避できてしまいますが、
//   それはサイト運営者が表明した意思を経路を変えて回避することになるため、やりません。

const UA = "civic-compass/0.1 (hackathon prototype; kokkai speech analysis)";
const REQUEST_INTERVAL_MS = 2000;
const AI_CRAWLER_AGENTS = ["claudebot", "claude-web", "anthropic-ai", "gptbot", "ccbot", "google-extended"];
const SELF_AGENTS = ["civic-compass", "*"];

const robotsCache = new Map(); // origin -> ルール
let lastRequestAt = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * クロール間隔を空けて取得する。
 *
 * 中間証明書を配信していないサイト（小泉進次郎の shinjiro.info など）は Node の fetch が
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE で落ちるため、その場合だけ curl に切り替える。
 * curl も検証はするので、証明書の検証自体を無効化しているわけではない。
 */
export async function fetchPolite(url) {
  try {
    return await fetchViaNode(url);
  } catch (e) {
    const code = e.cause?.code ?? "";
    if (!/UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_/.test(code)) throw e;
    return await fetchViaCurl(url);
  }
}

async function fetchViaCurl(url) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const { stdout } = await run("curl", ["-sSL", "--max-time", "25", "-A", UA, url], {
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

async function fetchViaNode(url) {
  const wait = REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const ct = res.headers.get("content-type") ?? "";
  // 画像やPDFをテキストとして読み込まないよう、HTML以外は弾く
  if (ct && !/text\/html|application\/xhtml/i.test(ct)) throw new Error(`HTMLではない (${ct.split(";")[0]})`);

  // 議員サイトには Shift_JIS のものがあるので Content-Type を見て復号する
  const charset = /charset=([\w-]+)/i.exec(ct)?.[1];
  const buf = await res.arrayBuffer();
  const first = new TextDecoder("utf-8").decode(buf.slice(0, 2048));
  const metaCharset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(first)?.[1];
  const enc = (charset ?? metaCharset ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(enc).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

async function loadRobots(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);

  let text = "";
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { "User-Agent": UA } });
    if (res.ok) text = await res.text();
  } catch {
    // robots.txt が取れない場合は許可扱い（慣習どおり）
  }

  // User-agent ごとに Disallow を集める
  const groups = new Map();
  let current = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, value] = [m[0], m[1].toLowerCase(), m[2].trim()];
    if (key === "user-agent") {
      const agent = value.toLowerCase();
      if (!groups.has(agent)) groups.set(agent, []);
      current = groups.get(agent);
    } else if (key === "disallow" && current) {
      current.push(value);
    }
  }

  robotsCache.set(origin, groups);
  return groups;
}

/**
 * 取得してよい URL かを判定する。
 * 自分向けの指示（civic-compass / *）に加え、AIクローラー向けの指示にも従う。
 */
export async function isAllowed(url) {
  const u = new URL(url);
  const groups = await loadRobots(u.origin);

  for (const agent of [...SELF_AGENTS, ...AI_CRAWLER_AGENTS]) {
    const rules = groups.get(agent);
    if (!rules) continue;
    for (const rule of rules) {
      if (rule === "") continue; // "Disallow:" は全許可の意味
      if (u.pathname.startsWith(rule)) {
        const kind = AI_CRAWLER_AGENTS.includes(agent) ? "AIクローラー向けに拒否" : "拒否";
        return { ok: false, reason: `User-agent: ${agent} / Disallow: ${rule}（${kind}）` };
      }
    }
  }
  return { ok: true };
}

export { UA };
