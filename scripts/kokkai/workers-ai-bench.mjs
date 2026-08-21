#!/usr/bin/env node
// Workers AI の各モデルで抽出を試し、Opus 5（手動抽出）の結果と突き合わせる。
//
//   node scripts/kokkai/workers-ai-bench.mjs [--models=a,b] [--n=6]
//
// 見るのは3点。
//   1. evidence_text が原文と一致するか  … 一致しないとタグを採用できない（設計の前提）
//   2. frame / target / stance が定義した語彙に収まるか
//   3. override を拾えるか               … 出現率が低く、落としやすい
//
// 認証は wrangler login の OAuth トークンを使う。

import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { FRAMES, TARGETS, STANCES, ROLES } from "./llm.mjs";
import { locate } from "./align.mjs";
import { getAccountId } from "./workers-ai.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const CANDIDATES = [
  "@cf/qwen/qwen3.8-27b",
  "@cf/zai-org/glm-5.2",
  "@cf/moonshotai/kimi-k2.6",
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/nvidia/nemotron-3-120b-a12b",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/openai/gpt-oss-120b",
];

const SCHEMA = {
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

function parseArgs(argv) {
  const args = { models: CANDIDATES, n: 6, verbose: false, all: false, concurrency: 3, out: null };
  for (const a of argv.slice(2)) {
    if (a === "--verbose") args.verbose = true;
    else if (a === "--all") args.all = true;
    else if (a.startsWith("--concurrency=")) args.concurrency = Number(a.slice(14));
    else if (a.startsWith("--out=")) args.out = a.slice(6);
    else if (a.startsWith("--models=")) args.models = a.slice(9).split(",");
    else if (a.startsWith("--n=")) args.n = Number(a.slice(4));
    else throw new Error(`不明な引数: ${a}`);
  }
  return args;
}

async function oauthToken() {
  const p = path.join(os.homedir(), "Library/Preferences/.wrangler/config/default.toml");
  const toml = await readFile(p, "utf8");
  const m = /oauth_token\s*=\s*"([^"]+)"/.exec(toml);
  if (!m) throw new Error("wrangler の OAuth トークンが見つかりません。`npx wrangler login` を実行してください");
  return m[1];
}

/**
 * Workers AI はモデルによって応答の形が違う。
 *   - 独自形式: result.response（文字列 or オブジェクト）
 *   - OpenAI互換: result.choices[0].message.content
 * reasoning モデルは content が null で reasoning に思考が入り、max_tokens を使い切ることがある。
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

async function runModel(token, model, system, user) {
  const started = Date.now();
  const accountId = await getAccountId();
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: SCHEMA },
      max_tokens: 8000,
    }),
  });

  const json = await res.json();
  if (!json.success) throw new Error(json.errors?.map((e) => e.message).join(" / ") ?? `HTTP ${res.status}`);

  const { text, finish } = extractText(json.result);
  if (text === null) throw new Error(`応答テキストを取り出せません (keys: ${Object.keys(json.result ?? {}).join(",")})`);
  if (finish === "length") throw new Error("max_tokens 到達（reasoning で使い切っている可能性）");

  return { parsed: JSON.parse(stripFence(text)), ms: Date.now() - started, finish };
}

/**
 * Opus5（手動抽出）との一致を段階別に数える。
 *   frame のみ / frame+stance / frame+stance+target+role
 * 同じ frame が複数あることがあるので、多重集合として突き合わせる。
 */
function agreement(goldFrames, modelFrames) {
  const keys = {
    frame: (f) => f.frame,
    stance: (f) => `${f.frame}|${f.stance}`,
    cell: (f) =>
      (f.targets ?? []).map((t) => `${f.frame}|${f.stance}|${t.entity}|${t.role}`).sort().join(";"),
  };
  const out = {};
  for (const [level, keyOf] of Object.entries(keys)) {
    const g = goldFrames.map(keyOf);
    const m = modelFrames.map(keyOf);
    const pool = [...g];
    let hit = 0;
    for (const k of m) {
      const i = pool.indexOf(k);
      if (i >= 0) {
        pool.splice(i, 1);
        hit++;
      }
    }
    out[level] = { hit, gold: g.length, model: m.length };
  }
  return out;
}

/** 1件の抽出結果を採点する */
function score(parsed, segText) {
  const frames = parsed?.justification_frames ?? [];
  const r = { frames: frames.length, evidenceOk: 0, evidenceNg: 0, vocabNg: 0, override: 0 };

  for (const f of frames) {
    const { match } = locate(segText, f.evidence_text ?? "");
    if (match === "not_found") r.evidenceNg++;
    else r.evidenceOk++;

    if (!FRAMES.includes(f.frame) || !STANCES.includes(f.stance)) r.vocabNg++;
    for (const t of f.targets ?? []) {
      if (!TARGETS.includes(t.entity) || !ROLES.includes(t.role)) r.vocabNg++;
    }
    if (f.stance === "override") r.override++;
  }
  return r;
}

async function main() {
  const args = parseArgs(process.argv);
  const token = await oauthToken();
  const system = await readFile(path.join(ROOT, "scripts/kokkai/prompts/extract.md"), "utf8");

  const segments = (await readFile(path.join(ROOT, "data/pilot/segments.jsonl"), "utf8"))
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const gold = new Map(
    (await readFile(path.join(ROOT, "data/pilot/utterances.jsonl"), "utf8"))
      .split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((u) => [u.utterance_id, u]),
  );

  // override を含むものを優先して選ぶ（拾えるかが焦点なので）
  const withOverride = segments.filter((s) =>
    (gold.get(s.segment_id)?.justification_frames ?? []).some((f) => f.stance === "override"),
  );
  const others = segments.filter((s) => !withOverride.includes(s));
  const targets = args.all
    ? segments
    : [...withOverride.slice(0, Math.ceil(args.n / 2)), ...others.slice(0, Math.floor(args.n / 2))];

  console.log(`対象 ${targets.length}件（override を含む ${Math.min(withOverride.length, Math.ceil(args.n / 2))}件）`);
  console.log(`モデル ${args.models.length}種\n`);

  const results = [];
  for (const model of args.models) {
    const agg = { model, ok: 0, fail: 0, ms: 0, frames: 0, evidenceOk: 0, evidenceNg: 0, vocabNg: 0, override: 0, error: null,
      agree: { frame: { hit: 0, gold: 0, model: 0 }, stance: { hit: 0, gold: 0, model: 0 }, cell: { hit: 0, gold: 0, model: 0 } },
      noValueAgree: 0, noValueTotal: 0, details: [] };
    const run = async (seg) => {
      try {
        const { parsed, ms } = await runModel(token, model, system, `以下の発言から正当化フレームを抽出してください。\n\n---\n${seg.text}\n---`);
        const s = score(parsed, seg.text);
        const g = gold.get(seg.segment_id);
        const gf = g?.justification_frames ?? [];
        const mf = parsed.justification_frames ?? [];
        const a = agreement(gf, mf);
        for (const lv of ["frame", "stance", "cell"]) {
          for (const k of ["hit", "gold", "model"]) agg.agree[lv][k] += a[lv][k];
        }
        agg.noValueTotal++;
        if (!!g?.no_value_content === (mf.length === 0)) agg.noValueAgree++;
        agg.details.push({
          segment_id: seg.segment_id,
          politician: seg.politician_name,
          gold: gf.map((f) => `${f.frame}/${f.stance}`),
          model: mf.map((f) => `${f.frame}/${f.stance}`),
        });
        if (args.verbose) {
          console.log(`  --- ${seg.politician_name} ${seg.segment_id}`);
          console.log(`      Opus5 : ${gf.map((f) => `${f.frame}/${f.stance}`).join("  ") || "（なし）"}`);
          console.log(`      model : ${mf.map((f) => `${f.frame}/${f.stance}`).join("  ") || "（なし）"}`);
        }
        agg.ok++;
        agg.ms += ms;
        for (const k of ["frames", "evidenceOk", "evidenceNg", "vocabNg", "override"]) agg[k] += s[k];
      } catch (e) {
        agg.fail++;
        agg.error ??= String(e.message).slice(0, 90);
      }
    };

    // レート制限に配慮しつつ並列で回す
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(args.concurrency, targets.length) }, async () => {
        while (next < targets.length) {
          const seg = targets[next++];
          await run(seg);
          if (!args.verbose && next % 10 === 0) process.stdout.write(`    ${next}/${targets.length}\r`);
        }
      }),
    );
    const goldOverride = targets.reduce(
      (a, s) => a + (gold.get(s.segment_id)?.justification_frames ?? []).filter((f) => f.stance === "override").length, 0);
    agg.goldOverride = goldOverride;
    results.push(agg);

    const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
    const A = agg.agree;
    console.log(`\n${model}`);
    console.log(`  成功              ${agg.ok}/${targets.length}${agg.error ? `（${agg.error}）` : ""}`);
    console.log(`  引用が原文と一致   ${pct(agg.evidenceOk, agg.frames)}（${agg.evidenceOk}/${agg.frames}）  ← 一致しないタグは破棄される`);
    console.log(`  語彙外            ${agg.vocabNg}`);
    console.log(`  override 検出     ${agg.override}件（Opus5 は ${goldOverride}件）`);
    console.log(`  価値含意なしの一致 ${pct(agg.noValueAgree, agg.noValueTotal)}`);
    console.log(`  Opus5 との一致（再現率 / 適合率）`);
    console.log(`    frame のみ       ${pct(A.frame.hit, A.frame.gold)} / ${pct(A.frame.hit, A.frame.model)}`);
    console.log(`    frame + stance   ${pct(A.stance.hit, A.stance.gold)} / ${pct(A.stance.hit, A.stance.model)}`);
    console.log(`    frame+stance+cell ${pct(A.cell.hit, A.cell.gold)} / ${pct(A.cell.hit, A.cell.model)}`);
    console.log(`  速度              ${agg.ok ? (agg.ms / agg.ok / 1000).toFixed(1) : "—"}秒/件`);
  }

  console.log("\n判定基準: 引用一致率が低いと、タグが全部破棄されるので使えません");
  if (args.out) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(ROOT, args.out), JSON.stringify(results, null, 2) + "\n", "utf8");
    console.log(`詳細: ${args.out}`);
  }
  return results;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
