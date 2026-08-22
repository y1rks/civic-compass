// Cloudflare Workers AI クライアント。
//
// モデル選定の経緯は docs/design-constraints.md「抽出モデルの選定」。glm-5.2 を使う。
// 認証は `wrangler login` の OAuth トークンを読む。
//
// レート制限について
//   Workers AI は「1分あたりの推論リクエスト数」で制限される（実測 約26件/分）。
//   並列度を上げても縮まないので、上限に当たったら待って再試行する。

import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { FRAMES, TARGETS, STANCES, ROLES } from "./llm.mjs";

export const DEFAULT_MODEL = "@cf/zai-org/glm-5.2";

/**
 * Cloudflare のアカウントID。
 * 環境変数 CLOUDFLARE_ACCOUNT_ID があればそれを使い、無ければ `wrangler whoami` から取る。
 * リポジトリに直接書かないための遠回りです。
 */
let cachedAccountId = null;
export async function getAccountId() {
  if (cachedAccountId) return cachedAccountId;
  if (process.env.CLOUDFLARE_ACCOUNT_ID) {
    cachedAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    return cachedAccountId;
  }

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { stdout } = await promisify(execFile)("npx", ["wrangler", "whoami"], { maxBuffer: 4 * 1024 * 1024 });
  const m = /\b([0-9a-f]{32})\b/.exec(stdout);
  if (!m) {
    throw new Error(
      "Cloudflare のアカウントIDが分かりません。\n" +
        "  export CLOUDFLARE_ACCOUNT_ID=... とするか、`npx wrangler login` を実行してください。",
    );
  }
  cachedAccountId = m[1];
  return cachedAccountId;
}

const MAX_RETRY = 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Workers AI は「1分あたりの推論リクエスト数」で制限される（実測 約26件/分）。
// 並列度で調整しようとすると必ず超過するので、**全リクエストを1本の間隔制御に通す**。
// 並列8でも12でも、ここを通る限り毎分の上限を超えない。
const MIN_INTERVAL_MS = 2500; // 24 req/分。上限26に対して少し余裕を持たせる
let nextSlot = 0;

async function throttle() {
  const now = Date.now();
  // 予約制にすることで、複数の呼び出しが同時に来ても間隔が詰まらない
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + MIN_INTERVAL_MS;
  const wait = slot - now;
  if (wait > 0) await sleep(wait);
}

export const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    no_value_content: { type: "boolean" },
    justification_frames: {
      type: "array",
      items: {
        type: "object",
        properties: {
          frame: { type: "string", enum: FRAMES },
          stance: { type: "string", enum: STANCES },
          intensity: { type: "number" },
          targets: {
            type: "array",
            items: {
              type: "object",
              properties: { entity: { type: "string", enum: TARGETS }, role: { type: "string", enum: ROLES } },
              required: ["entity", "role"],
            },
          },
          evidence_text: { type: "string" },
        },
        required: ["frame", "stance", "intensity", "targets", "evidence_text"],
      },
    },
    summary: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["no_value_content", "justification_frames", "summary", "confidence"],
};

export const SEGMENT_SCHEMA = {
  type: "object",
  properties: {
    segments: {
      type: "array",
      items: { type: "object", properties: { head: { type: "string" } }, required: ["head"] },
    },
  },
  required: ["segments"],
};

// wrangler の OAuth トークンには有効期限がある（実測1時間程度）。
// 長時間バッチではトークンが切れて Authentication error が出続けるので、
// 期限を見て先回りで、失効していたら wrangler にリフレッシュさせて読み直す。
const WRANGLER_CONFIG = path.join(os.homedir(), "Library/Preferences/.wrangler/config/default.toml");
const EXPIRY_MARGIN_MS = 5 * 60 * 1000; // 期限の5分前には更新する

let cachedToken = null;
let cachedExpiry = 0;

async function readTokenFromConfig() {
  const toml = await readFile(WRANGLER_CONFIG, "utf8");
  const token = /oauth_token\s*=\s*"([^"]+)"/.exec(toml)?.[1];
  if (!token) {
    throw new Error("wrangler の OAuth トークンが見つかりません。`npx wrangler login` を実行してください");
  }
  const exp = /expiration_time\s*=\s*"([^"]+)"/.exec(toml)?.[1];
  return { token, expiry: exp ? Date.parse(exp) : 0 };
}

/**
 * wrangler にトークンを更新させる。
 * wrangler は API を叩くときに期限を見て refresh_token で更新し、設定ファイルに書き戻す。
 * こちらから更新用のエンドポイントを叩くより、wrangler に任せるほうが確実。
 */
async function refreshViaWrangler() {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await promisify(execFile)("npx", ["wrangler", "whoami"], { maxBuffer: 4 * 1024 * 1024 });
}

export async function getToken({ force = false } = {}) {
  const stillValid = cachedToken && Date.now() < cachedExpiry - EXPIRY_MARGIN_MS;
  if (stillValid && !force) return cachedToken;

  let { token, expiry } = await readTokenFromConfig();

  // 設定ファイル側も切れていれば wrangler に更新させる
  if (force || (expiry && Date.now() >= expiry - EXPIRY_MARGIN_MS)) {
    await refreshViaWrangler();
    ({ token, expiry } = await readTokenFromConfig());
  }

  cachedToken = token;
  cachedExpiry = expiry || Date.now() + 30 * 60 * 1000;
  return cachedToken;
}

/**
 * モデルによって応答の形が違う。
 *   独自形式: result.response / OpenAI互換: result.choices[0].message.content
 */
function extractText(result) {
  if (typeof result?.response === "string") return { text: result.response, finish: null };
  if (result?.response && typeof result.response === "object") {
    return { text: JSON.stringify(result.response), finish: null };
  }
  const choice = result?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string" && content.length > 0) return { text: content, finish: choice.finish_reason };
  return { text: null, finish: choice?.finish_reason ?? null };
}

/** ```json ... ``` で囲んで返すモデルがあるので剥がす */
function stripFence(text) {
  const m = /```(?:json)?\s*\n([\s\S]*?)\n?```/.exec(text);
  return (m ? m[1] : text).trim();
}

const isRateLimit = (msg) => /rate limit|too many requests|429|capacity/i.test(msg);
const isAuthError = (msg) => /authentication|unauthor|invalid token|10000/i.test(msg);

/**
 * Workers AI を呼び、JSON スキーマに沿った結果を返す。
 * レート制限は待って再試行する（本番は17時間走るので、ここで諦めない）。
 */
export async function runStructured({ model = DEFAULT_MODEL, system, user, schema, maxTokens = 8000 }) {
  const accountId = await getAccountId();
  let tokens = maxTokens;

  for (let attempt = 1; ; attempt++) {
    let json;
    try {
      const token = await getToken();
      await throttle();
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_schema", json_schema: schema },
          max_tokens: tokens,
        }),
      });
      json = await res.json();
    } catch (e) {
      if (attempt >= MAX_RETRY) throw e;
      await sleep(3000 * attempt);
      continue;
    }

    if (!json.success) {
      const msg = json.errors?.map((e) => e.message).join(" / ") ?? "unknown error";
      // トークンの失効。取り直せば回復するので、リトライ回数を消費させない
      if (isAuthError(msg) && attempt < MAX_RETRY) {
        await getToken({ force: true });
        continue;
      }
      // レート制限は時間で回復するので、他のエラーより長めに待つ
      if (isRateLimit(msg) && attempt < MAX_RETRY) {
        await sleep(Math.min(20_000 * attempt, 60_000));
        continue;
      }
      if (attempt >= MAX_RETRY) throw new Error(msg);
      await sleep(3000 * attempt);
      continue;
    }

    const { text, finish } = extractText(json.result);
    if (text === null) {
      // finish=length は出力枠の不足。同じ条件で再試行しても無駄なので枠を広げる
      if (finish === "length") tokens = Math.min(tokens * 2, 32_000);
      if (attempt >= MAX_RETRY) throw new Error(`応答テキストを取り出せません (finish=${finish})`);
      await sleep(1000);
      continue;
    }

    try {
      return JSON.parse(stripFence(text));
    } catch (e) {
      // 出力が途中で切れていることがあるので、枠を広げて再試行する
      if (/Unterminated|Unexpected end/.test(e.message)) tokens = Math.min(tokens * 2, 32_000);
      if (attempt >= MAX_RETRY) throw new Error(`JSON をパースできません: ${e.message}`);
      await sleep(1000);
    }
  }
}
