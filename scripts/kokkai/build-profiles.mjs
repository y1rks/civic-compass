#!/usr/bin/env node
// 【1】utterances → 【2】議員プロファイル / 政党プロファイル / セル逆引きインデックス
//
//   node scripts/kokkai/build-profiles.mjs [--in=data/utterances.jsonl] [--min-n=3]
//
// 【1】から集計して作る派生データなので、**何度でも作り直せる**。
// 集計式が変われば、LLM を再実行せずここだけ回せばよい。
//
// 出力（KV に入れる想定。キーはファイル名と同じ）
//   data/profiles/profile_{speaker_id}.json      profile:P00001
//   data/profiles/party/profile_party_{名}.json  profile:party:自由民主党
//   data/profiles/cellidx/{連番}.json            cellidx:frame|target|role

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FRAMES } from "./llm.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "data/profiles");

const PROFILE_VERSION = "profile-v1.1";
const MAX_EVIDENCE = 3;

// override の重み。
//
// 実データでは uphold が96%を占め、override は4%しか出ない。単純な多数決で score を出すと
// 1件の override が大量の uphold に埋もれ、cells の97%が +0.9以上に張り付いて情報を持たなくなる。
//
// ただし override は「その価値を優先順位で下に置いた」という明示的な意思表示で、
// **めったに override しない人がそれをやったときほど情報量が大きい**。
// そこで議員ごとの override 率の逆数（の対数）を重みにする。distinctiveness と同じ稀少性の考え方。
const OVERRIDE_WEIGHT_CAP = 6.0;
const OVERRIDE_RATE_FLOOR = 0.005;

// share の平滑化。
//
// share は「そのセルの寄与 ÷ 全セルの寄与」なので、**分母がセルの総数に依存する**。
// 発言データが少ないと観測されるセルも少なく、1セルあたりの share が大きく出てしまう。
// 実測では、同じ議員でも 30セグメント時点で share 0.248 だったセルが、
// 557セグメントでは 0.050 まで薄まった（言及の傾向は変わっていないのに5倍の差）。
//
// このままマッチ計算の sqrt(u.share × p.share) に渡すと、データの少ない議員が
// 不当に高いスコアを取る。そこで擬似的な寄与を足して、観測が薄いうちは
// 均等分布（1/セル数）側に引き戻す。distinctiveness の PRIOR と同じ考え方。
const SHARE_PRIOR = 4.0; // 擬似寄与。実測の「1セルあたり平均寄与」3〜8 の下限側に合わせた

/** その話者が override をどれだけ使うかから、override 1件あたりの重みを決める */
export function overrideWeight(overrideRate) {
  const p = Math.max(overrideRate, OVERRIDE_RATE_FLOOR);
  return Math.min(1 + Math.log(1 / p), OVERRIDE_WEIGHT_CAP);
}

/** 発言群から override 率を出す。ユーザープロファイルでも同じ関数を使うこと */
export function calcOverrideRate(utterances) {
  let uphold = 0;
  let override = 0;
  for (const u of utterances) {
    for (const f of u.justification_frames ?? []) {
      if (f.stance === "uphold") uphold++;
      else if (f.stance === "override") override++;
    }
  }
  const total = uphold + override;
  return total > 0 ? override / total : 0;
}

function parseArgs(argv) {
  const args = { in: "data/utterances.jsonl", minN: 3, quiet: false };
  for (const a of argv.slice(2)) {
    if (a === "--quiet") args.quiet = true;
    else if (a.startsWith("--in=")) args.in = a.slice(5);
    else if (a.startsWith("--min-n=")) args.minN = Number(a.slice(8));
    else throw new Error(`不明な引数: ${a}`);
  }
  return args;
}

const cellKey = (c) => `${c.frame}|${c.target}|${c.role}`;
const sign = (stance) => (stance === "uphold" ? 1 : stance === "override" ? -1 : 0);
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * 1発言・1フレーム・1対象あたりの重み。
 *   intensity … その発言内での比重
 *   confidence … 抽出の確信度
 *   weight    … 答弁の「本人度」（党首討論1.0 / 予算委0.5 / 各省委0.3）
 * 3つを掛けることで、質の低い発言が score と share を押し上げないようにする。
 */
const contribution = (u, f) => (f.intensity ?? 0) * (u.confidence ?? 0) * (u.weight ?? 1);

/** score に効かせる重み。override は稀少性に応じて増幅する */
const stanceWeight = (stance, kOverride) => (stance === "override" ? kOverride : 1);

/** evidence は intensity × confidence × 新しさ の降順で最大3件 */
function pickEvidence(items) {
  return items
    .slice()
    .sort((a, b) => {
      if (b.rank !== a.rank) return b.rank - a.rank;
      return (b.date ?? "").localeCompare(a.date ?? "");
    })
    .slice(0, MAX_EVIDENCE)
    .map((e) => {
      const out = {
        utterance_id: e.utterance_id,
        date: e.date,
        summary: e.summary,
        url: e.url,
        frame: e.frame,
      };
      // 公式サイト由来は著作物なので原文を出さず、要約とリンクだけにする（§10）。
      // block_text も原文なので同じ扱い。
      if (e.quotable) {
        out.quote = e.quote;
        // 分割していない場合は quote と同じ文字列になるので null。
        // UI は `block_text ?? quote` で常に発言ブロック全文を得られる。
        out.block_text = e.block_text;
        // 根拠にした箇所とその位置。evidence_span は `block_text ?? quote` 上の絶対位置なので、
        // そのままハイライトに使える。
        out.evidence_text = e.evidence_text;
        out.evidence_span = e.evidence_span;
      }
      return out;
    });
}

function buildPolitician(master, utterances, minN) {
  const valued = utterances.filter((u) => !u.no_value_content);
  const overrideRate = calcOverrideRate(valued);
  const kOverride = overrideWeight(overrideRate);

  // (frame|target|role) ごとに寄与を集める
  const cells = new Map();
  for (const u of valued) {
    for (const f of u.justification_frames ?? []) {
      for (const t of f.targets ?? []) {
        // role: neutral は情報量がほぼなく疎になるだけなので cells に入れない（§3）
        if (t.role !== "beneficiary" && t.role !== "threat") continue;

        const key = `${f.frame}|${t.entity}|${t.role}`;
        if (!cells.has(key)) {
          cells.set(key, { frame: f.frame, target: t.entity, role: t.role, n: 0, num: 0, den: 0, denScore: 0, evidence: [] });
        }
        const cell = cells.get(key);
        const w = contribution(u, f);
        // share は素の寄与で、score は override を増幅した寄与で出す。
        // 「どれだけ語ったか」に override の増幅を持ち込むと、重視度が歪むため分けている。
        const sw = stanceWeight(f.stance, kOverride);
        cell.n += 1;
        cell.num += sign(f.stance) * w * sw;
        cell.denScore += w * sw;
        cell.den += w;
        cell.evidence.push({
          utterance_id: u.utterance_id,
          date: u.date,
          summary: u.summary,
          quote: u.quote,
          // 分割前のブロック全文。分割していなければ null（quote と同じ文字列になるため）
          block_text: u.block_text ?? null,
          url: u.source?.url ?? null,
          quotable: u.quotable !== false,
          frame: f.frame,
          evidence_text: f.evidence_text,
          evidence_span: f.evidence_span ?? null,
          rank: w,
        });
      }
    }
  }

  const kept = [...cells.values()].filter((c) => c.n >= minN);
  // share は件数ではなく寄与の合計で出す。答弁が件数で押し切るのを防ぐため。
  const totalDen = kept.reduce((a, c) => a + c.den, 0);
  // 平滑化後の分母。観測が薄いほど、各セルが 1/セル数 に近づく
  const smoothTotal = totalDen + SHARE_PRIOR * kept.length;

  // evidence は別ファイルに分ける。
  // C（マッチ度API）は全議員の cells を突合するので、そこに原文が混ざっていると
  // 15人分で十数MBを読むことになる。使うのは上位数人の evidence だけなので、
  // 「計算に要るもの」と「表示に要るもの」を分離する。
  const cellList = kept
    .map((c) => ({
      frame: c.frame,
      target: c.target,
      role: c.role,
      score: c.denScore > 0 ? round(c.num / c.denScore) : 0,
      share: smoothTotal > 0 ? round((c.den + SHARE_PRIOR) / smoothTotal) : 0,
      n: c.n,
    }))
    .sort((a, b) => b.share - a.share);

  const evidenceByCell = {};
  for (const c of kept) {
    evidenceByCell[`${c.frame}|${c.target}|${c.role}`] = pickEvidence(c.evidence);
  }

  // frame 単独へ畳む。
  //
  // ★語っていないフレームも share: 0 で必ず記録する。
  // 「語らなかった」ことも思想の情報だから。ある価値にまったく言及しない議員と、
  // 同じくその価値に言及しないユーザーは、その点で一致している。
  // 出現したフレームだけを持つと、この「両者とも関心がない」という一致を捨ててしまう。
  const frames = {};
  for (const f of FRAMES) {
    const group = kept.filter((c) => c.frame === f);
    if (group.length === 0) {
      // 観測されなかったフレーム。score は「向き」なので、語っていない以上 null にする
      frames[f] = { score: null, share: 0, n: 0 };
      continue;
    }
    const den = group.reduce((a, c) => a + c.den, 0);
    const denScore = group.reduce((a, c) => a + c.denScore, 0);
    const num = group.reduce((a, c) => a + c.num, 0);
    frames[f] = {
      score: denScore > 0 ? round(num / denScore) : 0,
      share: smoothTotal > 0 ? round((den + SHARE_PRIOR * group.length) / smoothTotal) : 0,
      n: group.reduce((a, c) => a + c.n, 0),
    };
  }

  return {
    profile: {
      speaker_id: master.speaker_id,
      politician_name: master.name,
      party: master.party,
      house: master.house,
      computed_at: new Date().toISOString(),
      profile_version: PROFILE_VERSION,
      window: null, // main で埋める
      n_segments_total: utterances.length,
      n_segments_valued: valued.length,
      // score の算出に使った override の重み。ユーザー側と突き合わせるときの参考になる
      override_rate: round(overrideRate, 4),
      override_weight: round(kOverride, 2),
      cells: cellList,
      frames,
      summary: null, // テンプレートで生成（LLM は使わない）
    },
    evidence: {
      speaker_id: master.speaker_id,
      politician_name: master.name,
      computed_at: new Date().toISOString(),
      profile_version: PROFILE_VERSION,
      // キーは cells と同じ `frame|target|role`。表示したいセルだけ引ける。
      cells: evidenceByCell,
    },
  };
}

/**
 * distinctiveness（突出度）= そのセルの share ÷ 全議員の平均share
 *
 * share だけだと「誰でも語る観点」と「その人しか語らない観点」が同じ重みになる。
 * 実測では care_harm は全議員が15〜35%を占める一方、liberty_autonomy は
 * 2%〜21%と10倍の開きがある。前者の一致は情報量が小さく、後者の一致は強い意味を持つ。
 *
 * 情報検索の IDF と同じ発想で、ありふれたセルの一致を割り引くために使う。
 * 全議員のプロファイルが出揃ってから計算するので、buildPolitician とは分けている。
 */
function attachDistinctiveness(profiles) {
  // セルごとに「そのセルを持つ議員の share」を集める
  const shares = new Map();
  for (const pr of profiles) {
    for (const c of pr.cells) {
      const key = cellKey(c);
      if (!shares.has(key)) shares.set(key, []);
      shares.get(key).push(c.share);
    }
  }

  // 平均は「そのセルを持つ議員」ではなく「全議員」で割る。
  // 一部の議員しか持たないセルほど平均が小さくなり、突出度が高く出る。
  //
  // ただし単純な比だと、1人しか持たない小さなセル（n=3〜4）が全部
  // 「議員数と同じ倍率」で頭打ちになり、互いに区別できなくなる。
  // 平均に下駄（PRIOR）を履かせて、share が小さいセルの倍率が伸びないようにする。
  // ベイズ平滑化と同じ考え方で、証拠が薄いセルを平均側に引き戻す。
  const n = profiles.length;
  const PRIOR = 0.01; // share 1% 相当の下駄

  for (const pr of profiles) {
    for (const c of pr.cells) {
      const all = shares.get(cellKey(c)) ?? [];
      const avg = all.reduce((a, v) => a + v, 0) / n;
      c.distinctiveness = round((c.share + PRIOR) / (avg + PRIOR));
    }
    // frames 側にも同じものを付ける（表示や粗いマッチで使う）
    const frameShares = new Map();
    for (const q of profiles) {
      for (const [f, v] of Object.entries(q.frames)) {
        if (!frameShares.has(f)) frameShares.set(f, 0);
        frameShares.set(f, frameShares.get(f) + v.share);
      }
    }
    for (const [f, v] of Object.entries(pr.frames)) {
      const avg = (frameShares.get(f) ?? 0) / n;
      v.distinctiveness = round((v.share + PRIOR) / (avg + PRIOR));
    }
    // 語っていないフレームがどれだけあるかは、マッチ計算で使う（下記§4）
    pr.silent_frames = Object.entries(pr.frames).filter(([, v]) => v.n === 0).map(([f]) => f);
  }
}

const FRAME_JA = {
  care_harm: "弱い立場への配慮",
  fairness: "公正さ",
  liberty_autonomy: "個人の自由と自己決定",
  loyalty_community: "共同体の結束",
  authority_order: "秩序と規律",
  sanctity_tradition: "伝統と尊厳",
  efficiency_utility: "効率と実利",
  procedure_rule_of_law: "手続きと法の支配",
  sovereignty: "国の自立",
  evidence_expertise: "科学と専門知",
};

/**
 * プロファイルの要約文。**LLM は使わない**（§6「LLMに政治家の主張を記憶から語らせる」の禁止）。
 *
 * share の上位を並べると、誰でも語るフレーム（care_harm / efficiency_utility /
 * procedure_rule_of_law）ばかりになり、全議員が似た要約になってしまう。
 * その人らしさを出すため **distinctiveness（全議員平均比）で並べる**。
 * ただし突出度だけだと n の小さいセルを拾うので、share が一定以上のものに限る。
 */
function makeSummary(profile) {
  const candidates = Object.entries(profile.frames).filter(([, v]) => v.n > 0 && v.share >= 0.03);
  if (candidates.length === 0) return "データが少ないため、傾向を示せません。";

  const top = candidates.sort((a, b) => b[1].distinctiveness - a[1].distinctiveness).slice(0, 3);

  const parts = top.map(([f, v]) => {
    const label = FRAME_JA[f] ?? f;
    if (v.score < -0.2) return `${label}よりも他の価値を優先する`;
    // 平均から離れているものは「特に」を付けて、横並びの印象を避ける
    return v.distinctiveness >= 1.5 ? `特に${label}を重んじる` : `${label}を重んじる`;
  });
  return `${parts.join("、")}傾向。`;
}

async function main() {
  const args = parseArgs(process.argv);
  const master = JSON.parse(await readFile(path.join(ROOT, "scripts/kokkai/politicians.json"), "utf8"));

  const utterances = (await readFile(path.join(ROOT, args.in), "utf8"))
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));

  const byPolitician = new Map();
  for (const u of utterances) {
    if (!byPolitician.has(u.speaker_id)) byPolitician.set(u.speaker_id, []);
    byPolitician.get(u.speaker_id).push(u);
  }

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(path.join(OUT_DIR, "party"), { recursive: true });
  await mkdir(path.join(OUT_DIR, "evidence"), { recursive: true });
  await mkdir(path.join(OUT_DIR, "cellidx"), { recursive: true });

  const profiles = [];
  for (const p of master.politicians) {
    if (p.active === false) continue; // 現職でない議員はマッチ候補から外す（§10）
    const us = byPolitician.get(p.speaker_id) ?? [];
    if (us.length === 0) continue;

    const { profile, evidence } = buildPolitician(p, us, args.minN);
    const dates = us.map((u) => u.date).filter(Boolean).sort();
    profile.window = { from: master.extract_window.from, to: master.extract_window.to, data_range: dates.length ? [dates[0], dates.at(-1)] : null };
    // summary は distinctiveness を使うので、attachDistinctiveness の後で入れる
    profiles.push(profile);

    await writeFile(path.join(OUT_DIR, `profile_${p.speaker_id}.json`), JSON.stringify(profile, null, 2) + "\n", "utf8");
    await writeFile(path.join(OUT_DIR, `evidence/evidence_${p.speaker_id}.json`), JSON.stringify(evidence, null, 2) + "\n", "utf8");
  }

  // 全議員が出揃ってから突出度を計算し、プロファイルに書き戻す
  attachDistinctiveness(profiles);
  for (const pr of profiles) pr.summary = makeSummary(pr);
  for (const pr of profiles) {
    await writeFile(path.join(OUT_DIR, `profile_${pr.speaker_id}.json`), JSON.stringify(pr, null, 2) + "\n", "utf8");
  }

  // --- 政党プロファイル：所属議員の cells を n で加重平均（対象1人の党も含める）---
  const byParty = new Map();
  for (const pr of profiles) {
    if (!byParty.has(pr.party)) byParty.set(pr.party, []);
    byParty.get(pr.party).push(pr);
  }

  const partyProfiles = [];
  for (const [party, members] of byParty) {
    const cells = new Map();
    for (const m of members) {
      for (const c of m.cells) {
        const key = cellKey(c);
        if (!cells.has(key)) cells.set(key, { frame: c.frame, target: c.target, role: c.role, n: 0, scoreNum: 0, shareNum: 0 });
        const agg = cells.get(key);
        agg.n += c.n;
        agg.scoreNum += c.score * c.n;
        agg.shareNum += c.share * c.n;
      }
    }
    const totalN = [...cells.values()].reduce((a, c) => a + c.n, 0);
    const profile = {
      party,
      computed_at: new Date().toISOString(),
      profile_version: PROFILE_VERSION,
      n_politicians: members.length,
      politicians: members.map((m) => m.speaker_id),
      cells: [...cells.values()]
        .map((c) => ({
          frame: c.frame, target: c.target, role: c.role,
          score: c.n > 0 ? round(c.scoreNum / c.n) : 0,
          share: totalN > 0 ? round(c.n / totalN) : 0,
          n: c.n,
        }))
        .sort((a, b) => b.share - a.share),
    };
    partyProfiles.push(profile);
    const safe = party.replace(/[^\p{L}\p{N}]/gu, "_");
    await writeFile(path.join(OUT_DIR, `party/profile_party_${safe}.json`), JSON.stringify(profile, null, 2) + "\n", "utf8");
  }

  // --- 【2b】セル逆引きインデックス：KV はセル→議員の逆引きができないので別途作る ---
  //
  // B（ポップアップ）がこれだけで完結できるよう、politician_name と distinctiveness も持たせる。
  // profile:{id} を引き直さずに「この議員にとって平均の何倍か」を出せる。
  // なお同一セル内では distinctiveness は share の単調増加関数なので、
  // 並べ替えの基準としては share と等価（値を表示・重み付けに使う用途で持つ）。
  const index = new Map();
  for (const pr of profiles) {
    for (const c of pr.cells) {
      const key = cellKey(c);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({
        speaker_id: pr.speaker_id,
        politician_name: pr.politician_name,
        party: pr.party,
        score: c.score,
        share: c.share,
        distinctiveness: c.distinctiveness,
        n: c.n,
      });
    }
  }

  const manifest = [];
  for (const [key, list] of index) {
    list.sort((a, b) => b.share - a.share);
    const file = `cellidx/${manifest.length.toString().padStart(4, "0")}.json`;
    manifest.push({ kv_key: `cellidx:${key}`, file, n_politicians: list.length });
    await writeFile(path.join(OUT_DIR, file), JSON.stringify(list, null, 2) + "\n", "utf8");
  }
  await writeFile(path.join(OUT_DIR, "cellidx/_manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  // --- レポート ---
  if (!args.quiet) {
    const pad = (s, n) => String(s).padEnd(n, " ");
    console.log(`入力 ${args.in}  ${utterances.length}セグメント / セル採用条件 n >= ${args.minN}\n`);
    console.log([pad("議員", 12), pad("segs", 6), pad("有価値", 7), pad("cells", 6), "上位フレーム"].join(""));
    for (const pr of profiles) {
      const top = Object.entries(pr.frames).sort((a, b) => b[1].share - a[1].share).slice(0, 3)
        .map(([f, v]) => `${f}(${Math.round(v.share * 100)}%${v.score < -0.2 ? " ▼" : ""})`).join(" ");
      console.log([
        pad(pr.politician_name, 12 - (pr.politician_name.length - [...pr.politician_name].length)),
        pad(pr.n_segments_total, 6), pad(pr.n_segments_valued, 7), pad(pr.cells.length, 6), top,
      ].join(""));
    }
    const { stat } = await import("node:fs/promises");
    let profBytes = 0;
    let evBytes = 0;
    for (const pr of profiles) {
      profBytes += (await stat(path.join(OUT_DIR, `profile_${pr.speaker_id}.json`))).size;
      evBytes += (await stat(path.join(OUT_DIR, `evidence/evidence_${pr.speaker_id}.json`))).size;
    }
    console.log("\n=== 各議員に特徴的なセル（distinctiveness 上位）===");
    for (const pr of profiles) {
      const top = pr.cells
        .filter((c) => c.n >= args.minN)
        .sort((a, b) => b.distinctiveness - a.distinctiveness)
        .slice(0, 2)
        .map((c) => `${c.frame}×${c.target}(${c.distinctiveness.toFixed(1)}倍)`)
        .join("  ");
      console.log(`  ${pr.politician_name.padEnd(8)} k=${pr.override_weight}  ${top}`);
    }

    console.log(`\nサイズ  profile ${(profBytes / 1024).toFixed(0)}KB（マッチ計算はこちらだけ読む）`);
    console.log(`        evidence ${(evBytes / 1024).toFixed(0)}KB（表示する議員の分だけ読む）`);
    console.log(`\n政党プロファイル ${partyProfiles.length}件  ${partyProfiles.map((p) => `${p.party}(${p.n_politicians}人/${p.cells.length}セル)`).join(" ")}`);
    console.log(`セル逆引き ${manifest.length}件`);
    console.log(`出力 data/profiles/`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
