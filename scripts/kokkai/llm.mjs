// segment 分割・フレーム抽出の LLM 呼び出し。
//
// 設計上の約束（CLAUDE.personalize.md §6）
//   - 分割と抽出は必ず別呼び出しにする（境界判定と抽出が同時に走ると品質が落ちる）
//   - LLM にスコア（-1〜+1の連続値）を直接出させない。離散ラベルと intensity まで
//   - 推論でタグを付けさせない。evidence_text を原文と照合し、一致しないタグは破棄する
//
// 位置情報について
//   LLM に文字位置（char_range / evidence_span）を数えさせると必ずずれるので、
//   「原文からの抜き出し」を返させて、位置の特定はこちら側で indexOf する。
//   これは精度の問題であると同時に、**原文にない引用を機械的に検出できる**という
//   品質保証の仕掛けでもある。

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

// APIキーは環境変数か .env から読む（.env は .gitignore 済み）。
// 環境変数が既にあればそちらを優先する。
try {
  const env = await readFile(path.join(ROOT, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {
  // .env がなければ環境変数だけを使う
}

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "ANTHROPIC_API_KEY が設定されていません。\n" +
      "  export ANTHROPIC_API_KEY=sk-ant-... とするか、\n" +
      "  リポジトリ直下の .env に ANTHROPIC_API_KEY=sk-ant-... と書いてください（.gitignore 済み）。",
  );
}

export const MODEL = "claude-opus-5";

// --- 語彙定義（CLAUDE.personalize.md §2。変更禁止） ---------------------------

export const FRAMES = [
  "care_harm",
  "fairness",
  "liberty_autonomy",
  "loyalty_community",
  "authority_order",
  "sanctity_tradition",
  "efficiency_utility",
  "procedure_rule_of_law",
  "sovereignty",
  "evidence_expertise",
];

export const TARGETS = [
  "個人",
  "家族",
  "子ども・将来世代",
  "高齢者",
  "現役世代",
  "女性",
  "障害者・マイノリティ",
  "中小企業",
  "大企業・産業",
  "地方",
  "国民全体",
  "外国人・移民",
  "国際社会",
  "自然環境",
];

export const STANCES = ["uphold", "override", "neutral"];
export const ROLES = ["beneficiary", "threat", "neutral"];

// --- 出力スキーマ -------------------------------------------------------------

const SegmentSchema = z.object({
  segments: z
    .array(
      z.object({
        head: z.string().describe("このセグメントの冒頭。原文から一字一句そのまま20〜40字"),
      }),
    )
    .describe("話題のまとまりごとに分割した結果。分割不要なら1件"),
});

const ExtractSchema = z.object({
  no_value_content: z.boolean().describe("価値含意がない発言なら true"),
  justification_frames: z.array(
    z.object({
      frame: z.enum(FRAMES),
      stance: z.enum(STANCES),
      intensity: z.number().min(0).max(1).describe("この発言内での比重"),
      targets: z.array(
        z.object({
          entity: z.enum(TARGETS),
          role: z.enum(ROLES),
        }),
      ),
      evidence_text: z.string().describe("そう判断した根拠。原文から一字一句そのまま10〜80字"),
    }),
  ),
  summary: z.string().describe("この発言の立場を一文で"),
  confidence: z.number().min(0).max(1),
});

// --- プロンプト ---------------------------------------------------------------

let cachedPrompts = null;
async function prompts() {
  if (!cachedPrompts) {
    const [segment, extract] = await Promise.all([
      readFile(path.join(HERE, "prompts/segment.md"), "utf8"),
      readFile(path.join(HERE, "prompts/extract.md"), "utf8"),
    ]);
    cachedPrompts = { segment, extract };
  }
  return cachedPrompts;
}

// --- API 呼び出し -------------------------------------------------------------

const client = new Anthropic();

/**
 * system は毎回同じなのでキャッシュする。抽出プロンプトは約6千トークンあるので、
 * キャッシュが効かないと入力コストがそのまま件数倍になる。
 */
async function parseWithSchema({ system, user, schema, effort = "high" }) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await client.messages.parse({
        model: MODEL,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        output_config: { effort, format: zodOutputFormat(schema) },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
      });
      if (res.stop_reason === "refusal") throw new Error(`refusal: ${res.stop_details?.category}`);
      if (!res.parsed_output) throw new Error("スキーマに沿った出力が得られませんでした");
      return { output: res.parsed_output, usage: res.usage };
    } catch (e) {
      const retryable =
        e instanceof Anthropic.RateLimitError ||
        e instanceof Anthropic.APIConnectionError ||
        (e instanceof Anthropic.APIError && e.status >= 500);
      if (!retryable || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt * attempt));
    }
  }
}

/** 発言ブロックを話題のまとまりに分割する（境界だけを決める。価値判定はしない） */
export async function splitIntoSegments(text) {
  const { segment } = await prompts();
  const { output, usage } = await parseWithSchema({
    system: segment,
    user: `以下の発言を分割してください。\n\n---\n${text}\n---`,
    schema: SegmentSchema,
    effort: "low", // 境界判定だけなので深く考えさせない
  });
  return { heads: output.segments.map((s) => s.head), usage };
}

/** segment から正当化フレームを抽出する */
export async function extractFrames(text) {
  const { extract } = await prompts();
  const { output, usage } = await parseWithSchema({
    system: extract,
    user: `以下の発言から正当化フレームを抽出してください。\n\n---\n${text}\n---`,
    schema: ExtractSchema,
  });
  return { extracted: output, usage };
}
