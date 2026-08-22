# データ仕様（D1 / KV）

議員プロファイル構築バッチ（`scripts/kokkai/`）が生成し、D1 と KV に格納されているデータの仕様。
設計の背景や「なぜそうしたか」は `docs/design-constraints.md` にある。ここでは
**何が入っていて、どう読むか**に絞る。

## 全体像

```
国会会議録API / 議員の公式サイト
        ↓  収集・前処理・LLM抽出
【1】utterances  ──→  D1     発言1セグメントごとの抽出結果。追記のみ・書き換え禁止
        ↓  集計（何度でも作り直せる）
【2】profile     ──→  KV     議員プロファイル。マッチ計算に使う
    evidence     ──→  KV     根拠となった発言の原文。表示に使う
    cellidx      ──→  KV     セル→議員の逆引き
```

| | 置き場 | バインディング | 用途 |
|---|---|---|---|
| utterances | D1 `civic-compass-db` | `DB` | 抽出結果の原本。プロファイルの再生成元 |
| profile / evidence / cellidx | KV | `PROFILES` | API が読む。D1 は引かない |

**API は基本的に KV だけを読む。** D1 はプロファイルを作り直すときの元データとして持っている。

---

## 中核となる概念

### セル（cell）—— `frame × target × role`

このアプリの中核。「**何を根拠に、誰について、どちら向きに語ったか**」の組み合わせ。

```
sovereignty × 国際社会 × threat        主権を根拠に、国際社会を脅威として語った
care_harm   × 外国人・移民 × beneficiary  ケアを根拠に、外国人を守る対象として語った
```

政策への賛否ではなく**正当化の論理**でマッチさせるための単位。
同じ「選択的夫婦別姓に賛成」でも、個人の自己決定から言う人とジェンダー平等から言う人は
別の思想である、という考え方（`docs/design-constraints.md`「中核の設計思想」）。

**`role` を落としてはいけない。** 落とすと正反対の思想が同一視される。
実データでも `efficiency_utility × 大企業・産業` を `beneficiary` で語る議員（産業振興）と
`threat` で語る議員（既得権益批判）に分かれている。

### frame（10種）—— 何を根拠にしたか

| ID | 日本語 |
|---|---|
| `care_harm` | ケア・被害 |
| `fairness` | 公正・互恵 |
| `liberty_autonomy` | 自由・自己決定 |
| `loyalty_community` | 共同体・絆 |
| `authority_order` | 権威・秩序 |
| `sanctity_tradition` | 伝統・尊厳・自然 |
| `efficiency_utility` | 効率・実利 |
| `procedure_rule_of_law` | 手続き・法の支配 |
| `sovereignty` | 主権・自立 |
| `evidence_expertise` | 科学・専門知 |

### target（14種）—— 誰について語ったか

```
個人 / 家族 / 子ども・将来世代 / 高齢者 / 現役世代 / 女性 /
障害者・マイノリティ / 中小企業 / 大企業・産業 / 地方 /
国民全体 / 外国人・移民 / 国際社会 / 自然環境
```

### role（3種）—— その対象をどう扱ったか

- `beneficiary` … 守る対象・利益を及ぼす対象
- `threat` … 脅威・問題の原因
- `neutral` … 言及のみ（**プロファイルの cells には含まれない**）

### stance（3種）—— その価値をどう扱ったか

- `uphold` … その価値を**根拠として持ち出した**
- `override` … その価値を**優先順位で下に置いた**（「その価値に反対」ではない）
- `neutral` … 向きが読めない

実データでは uphold が96%、override が4%。
`override` は稀だが情報量が大きく、`score` の計算では稀少性に応じて増幅している。

---

## 【1】utterances（D1）

発言を話題のまとまりで区切った1セグメントごとに1行。**追記のみ・書き換え禁止**。
集計式が変わっても、ここが残っていれば LLM を再実行せずにプロファイルを作り直せる。

### `utterances`

| 列 | 型 | 意味 |
|---|---|---|
| `utterance_id` | TEXT PK | `{block_id}_seg{NN}`。決定的に決まる |
| `speaker_id` | TEXT | `P00001` など。`scripts/kokkai/politicians.json` が正 |
| `politician_name` | TEXT | 表示用 |
| `source_kind` | TEXT | `kokkai` / `web` / `manual` |
| `meeting_id` `speech_id` `speech_index` | TEXT/INT | 国会会議録 API の識別子 |
| `segment_index` | INT | 発言ブロックを分割したときの通し番号 |
| `char_range_start` `char_range_end` | INT | 元ブロック内での位置 |
| `url` | TEXT | 出典。**表示時は必ず併記する**（§10） |
| `date` | TEXT | 発言日。web 由来で日付が読めない場合は NULL |
| `speech_type` | TEXT | `国会質疑` / `政府答弁` / `本会議` / `選挙公約` |
| `answer_context` | TEXT | 下記 |
| `weight` | REAL | 下記 |
| `position_at_time` | TEXT | **発言時点**の役職。API の値そのまま |
| `party_at_time` | TEXT | **発言時点**の会派。現所属ではない |
| `extract_version` `segmentation_version` | TEXT | 再現性のため |
| `no_value_content` | INT(bool) | 価値含意なし。**true でも行は残す**（share の分母・監査に要る） |
| `summary` | TEXT | この発言の立場を一文で |
| `confidence` | REAL | 抽出の確信度 |
| `quote` | TEXT | このセグメントの全文 |
| `block_text` | TEXT | 分割前のブロック全文。**分割していなければ NULL** |
| `quotable` | INT(bool) | 下記 |
| `rejected_frames` | TEXT(JSON) | 原文に引用が見つからず採用しなかったフレーム（監査用） |

#### `answer_context` と `weight`

政府答弁は官僚が作成した統一見解なので本人の価値観として扱えない——が、
実測すると**会議の種類で大きく違った**。定型表現の出現率を測って重みを決めている。

| `answer_context` | 会議 | 定型表現率 | `weight` |
|---|---|---:|---:|
| `spontaneous` | 質問する側の発言 | — | 1.0 |
| `party_leader_debate` | 党首討論 | 2.3% | 1.0 |
| `budget_committee_answer` | 予算委員会での答弁 | 7.0% | 0.5 |
| `ministry_committee_answer` | 各省委員会での答弁 | 10.6% | 0.3 |
| `plenary_answer` | 本会議での答弁 | 81.3% | 抽出しない |

`weight` は集計時に `intensity × confidence` に掛ける。これがないと、
件数の多い各省委員会答弁がプロファイルを押し切ってしまう。

#### `quotable` —— 原文を表示してよいか

- `true`（国会会議録）… 公文書なので `quote` をそのまま表示できる
- `false`（議員の公式サイト）… 著作物なので**要約とリンクに留める**（§10）

**`quotable: false` のときは `quote` / `block_text` / `evidence_text` を画面に出さないこと。**
KV の evidence 側では、そもそもこれらのフィールドが入っていない。

### `utterance_frames`

1セグメントから抽出したフレーム。1行1フレーム。

| 列 | 意味 |
|---|---|
| `frame_id` | `{utterance_id}_f{NN}` |
| `utterance_id` | 親 |
| `speaker_id` | 集計を1テーブルで済ませるための非正規化 |
| `frame` `stance` `intensity` | 抽出結果。`intensity` はその発言内での比重 0〜1 |
| `evidence_text` | そう判断した根拠。**原文からの一字一句の引用** |
| `evidence_span_start` `evidence_span_end` | `block_text ?? quote` 上の絶対位置 |
| `evidence_match` | `exact` / `normalized` |

**`evidence_text` は必ず原文に実在する。** LLM に位置を数えさせず、返ってきた抜き出しを
原文と照合して位置を特定している。照合できないタグは採用せず `rejected_frames` に回す。
これにより「推論でタグを付けない」が構造的に強制される（§6）。

### `utterance_frame_targets`

フレームが誰について語られたか。1フレームが複数の対象を持つことがある。

| 列 | 意味 |
|---|---|
| `frame_id` | 親（複合主キーの一部） |
| `entity` | target 14種 |
| `role` | `beneficiary` / `threat` / `neutral` |

```
「外国資本や移民による日本の破壊を止める」
  → sanctity_tradition / uphold
      targets: [外国人・移民 = threat, 国民全体 = beneficiary]
```

---

## 【2】profile（KV: `profile:{speaker_id}`）

utterances を集計した派生データ。**何度でも作り直せる。**
C（マッチ度API）は**全議員のこれを読む**ので、原文は含めない（9人で98KB）。

```jsonc
{
  "speaker_id": "P00001",
  "politician_name": "高市早苗",
  "party": "自由民主党",          // 現在の所属
  "house": "衆議院",

  "computed_at": "2026-08-22T07:01:05.337Z",
  "profile_version": "profile-v1.1",
  "window": {
    "from": "2020-08-01",         // 抽出対象にした期間（全議員共通）
    "to": "2026-08-22",
    "data_range": ["2021-12-13", "2026-07-27"]   // 実際にデータがある範囲
  },

  "n_segments_total": 644,        // no_value_content を含む
  "n_segments_valued": 557,       // 価値含意ありの数

  "override_rate": 0.0282,        // この議員が override を使う割合
  "override_weight": 4.57,        // score 計算での override の重み（下記）

  "cells": [
    {
      "frame": "efficiency_utility",
      "target": "国民全体",
      "role": "beneficiary",
      "score": 1,                 // -1〜+1
      "share": 0.082,             // 全セル中の比重。合計1.0
      "n": 168,                   // 該当したフレームの数
      "distinctiveness": 1.077    // 全議員平均の何倍か
    }
  ],

  "frames": {                     // frame 単独に畳んだもの。★語っていない frame も入る
    "care_harm": { "score": 1, "share": 0.278, "n": 379, "distinctiveness": 1.279 },
    "sanctity_tradition": { "score": null, "share": 0, "n": 0, "distinctiveness": 0.4 }
  },
  "silent_frames": [],            // n=0 の frame 一覧

  "summary": "特に国の自立を重んじる、弱い立場への配慮を重んじる、効率と実利を重んじる傾向。"
}
```

### 3つの指標が測っているもの

**別々のことを測っている。どれか1つでマッチさせないこと。**

| 指標 | 何を測るか | 範囲 | たとえると |
|---|---|---|---|
| `share` | その人が**どれだけ語ったか**（重視度） | 0〜1。合計1.0 | 話題の**配分** |
| `score` | その価値を**支持したか退けたか** | −1〜+1 | 態度の**向き** |
| `distinctiveness` | 全議員平均の**何倍語っているか** | 1.0が平均並み | その人**らしさ** |

```
sovereignty × 国民全体 × beneficiary
  share=0.105           発言の10.5%がこの観点
  score=+0.91           ほぼ常に「主権を根拠として持ち出した」
  distinctiveness=2.11  全議員平均の2.1倍。この人らしい観点
```

#### なぜ `distinctiveness` が要るか

`share` だけだと「誰でも語る観点」と「その人しか語らない観点」が同じ重みになる。
実測では `care_harm` は全議員が16〜31%を占める一方、`sovereignty` は2〜14%（7.1倍の開き）。
**前者の一致は情報量が小さく、後者の一致は強い意味を持つ。**

マッチ計算ではセルの重なりに掛けて使う。

```js
const overlap = Math.sqrt(u.share * p.share) * Math.log(1 + p.distinctiveness);
```

#### `score` の読み方に注意

**実データでは cells の97%が +0.9以上**。uphold が96%を占めるためで、これは構造的な性質。
「みんな同じ」ではなく「その価値をどう扱ったかは大半が uphold」という意味。

したがって **`score` だけでマッチさせると全員100%になる。** 主軸は `share` にすること。
ただし `liberty_autonomy` は override 率が20%と突出しており、このフレームでは
`score` が実際に弁別に効く（「死にたい自由」「自由主義的なマネーゲーム」など）。

`override_weight` は「めったに override しない人の override ほど情報量が大きい」
という考えで、議員ごとの override 率から算出している。

```
k = min(1 + ln(1 / override率), 6.0)
```

**ユーザープロファイルを作るときは、議員側と同じ補正を掛けること。**
片方だけ増幅するとスケールが合わない。回答が10件未満なら全議員平均（6.6%、k=3.72）を使う。

---

## 【2a】evidence（KV: `profile:evidence:{speaker_id}`）

プロファイルとは**別キー**。C は全議員の cells を突き合わせるので、
そこに原文が混ざっていると読み込み量が跳ね上がる（実測で profile 9KB : evidence 1.1MB）。
**上位数人の分だけ読む。**

```jsonc
{
  "speaker_id": "P00001",
  "politician_name": "高市早苗",
  "computed_at": "...",
  "profile_version": "profile-v1.1",

  // キーは cells と同じ `frame|target|role`
  "cells": {
    "sovereignty|国民全体|beneficiary": [
      {
        "utterance_id": "P00001_..._seg01",
        "date": "2026-05-20",
        "summary": "…",
        "url": "https://kokkai.ndl.go.jp/txt/…",
        "frame": "sovereignty",

        // ↓ quotable: true のときだけ入る（国会会議録＝公文書）
        "quote": "…このセグメントの全文…",
        "block_text": "…分割前のブロック全文。分割していなければ null…",
        "evidence_text": "…そう判断した根拠の箇所…",
        "evidence_span": [282, 411]
      }
    ]
  }
}
```

1セルにつき最大3件。`intensity × confidence × 新しさ` の降順。

### 根拠箇所のハイライト

`evidence_span` は `block_text ?? quote` 上の絶対位置なので、そのまま使える。

```js
const full = e.block_text ?? e.quote;   // 常に発言ブロック全文が得られる
const [s, t] = e.evidence_span;
full.slice(s, t)                        // → 根拠にした箇所
```

`block_text` が `null` なのは「分割していない＝`quote` がブロック全文」という意味。
同じ文字列を二重に持たないための省略。

### 公式サイト由来は原文を出さない

`quote` / `block_text` / `evidence_text` / `evidence_span` が**入っていない**エントリは
議員の公式サイト由来。著作物なので `summary` と `url` だけで表示すること（§10）。

---

## 【2b】cellidx（KV: `cellidx:{frame}|{target}|{role}`）

KV はセル→議員の逆引きができないので、バッチで別途作っている。
**B（意見保存直後のポップアップ）で使う。** ユーザーの意見から抽出したセルで引き、
同じセルを持つ議員を得る。

```jsonc
[
  {
    "speaker_id": "P00007",
    "politician_name": "斉藤鉄夫",
    "party": "中道改革連合",
    "score": 0.383,
    "share": 0.009,
    "distinctiveness": 1.583,   // この議員にとって平均の1.6倍
    "n": 10
  }
]
```

`share` の降順。**B はこれだけで議員名・党名まで出せる**ので、
候補を絞る段階で `profile:{id}` を読む必要はない。

`distinctiveness` を持たせているのは表示や重み付けのため。
**並べ替えの基準としては `share` と等価**である点に注意
（同一セル内では `distinctiveness = (share + PRIOR) / (avg + PRIOR)` の `avg` が共通なので、
`share` の単調増加関数になる。実測でも93セル全部で順序が一致した）。

---

## 【2c】政党プロファイル（KV: `profile:party:{党名}`）

所属議員の cells を `n` で加重平均したもの。**対象議員が1人の党も含める**（プロトタイプ方針）。

```jsonc
{
  "party": "自由民主党",
  "n_politicians": 4,
  "politicians": ["P00001", "P00002", "P00003", "P00004"],
  "cells": [ { "frame": "...", "target": "...", "role": "...", "score": 0.9, "share": 0.05, "n": 120 } ]
}
```

evidence は持たない。大政党ほど平均でマッチ度が中庸に寄る点に注意。

---

## 参照方法

### KV

すべて `--remote` が要る。付けないとローカルの空 KV を見てしまう。

```bash
# キー一覧
npx wrangler kv key list --binding=PROFILES --config api/wrangler.jsonc --remote

# 議員プロファイル
npx wrangler kv key get "profile:P00001" \
  --binding=PROFILES --config api/wrangler.jsonc --remote | python3 -m json.tool

# セル逆引き（このセルを持つ議員は誰か）
npx wrangler kv key get "cellidx:sovereignty|国民全体|beneficiary" \
  --binding=PROFILES --config api/wrangler.jsonc --remote

# 政党プロファイル
npx wrangler kv key get "profile:party:自由民主党" \
  --binding=PROFILES --config api/wrangler.jsonc --remote

# evidence（原文つき。1MB前後あるので先頭だけ見る）
npx wrangler kv key get "profile:evidence:P00001" \
  --binding=PROFILES --config api/wrangler.jsonc --remote | head -c 2000
```

#### evidence から特定のセルだけ取り出す

`profile:evidence:{id}` は 1MB 前後あるので、そのまま眺めるには大きい。
`cells` のキーは `frame|target|role` なので、そこだけ抜き出す。

```bash
# セルの一覧を見る
npx wrangler kv key get "profile:evidence:P00001" \
  --binding=PROFILES --config api/wrangler.jsonc --remote \
  | python3 -c "import json,sys; print('\n'.join(json.load(sys.stdin)['cells'].keys()))"

# ひとつのセルの evidence を読む
npx wrangler kv key get "profile:evidence:P00001" \
  --binding=PROFILES --config api/wrangler.jsonc --remote \
  | python3 -c "
import json,sys
ev = json.load(sys.stdin)['cells']['sovereignty|国民全体|beneficiary']
for e in ev:
    print(f\"[{e['date']}] {e['summary']}\")
    print(f\"  根拠: {e.get('evidence_text', '（公式サイト由来のため非表示）')}\")
    print(f\"  出典: {e['url']}\")
    print()
"

# 根拠箇所を前後の文脈つきで見る（evidence_span でハイライトする要領）
npx wrangler kv key get "profile:evidence:P00001" \
  --binding=PROFILES --config api/wrangler.jsonc --remote \
  | python3 -c "
import json,sys
e = json.load(sys.stdin)['cells']['sovereignty|国民全体|beneficiary'][0]
full = e.get('block_text') or e.get('quote')
if not full: raise SystemExit('公式サイト由来のため原文なし')
s, t = e['evidence_span']
print(full[:s], '【', full[s:t], '】', full[t:], sep='')
"
```

`jq` が入っていれば同じことを短く書ける。

```bash
npx wrangler kv key get "profile:evidence:P00001" \
  --binding=PROFILES --config api/wrangler.jsonc --remote \
  | jq '.cells["sovereignty|国民全体|beneficiary"][0] | {date, summary, evidence_text, url}'
```

ブラウザなら Cloudflare ダッシュボード → **Storage & Databases → KV → PROFILES**。

### D1

```bash
# 件数
npx wrangler d1 execute civic-compass-db --remote --config api/wrangler.jsonc \
  --command "SELECT COUNT(*) FROM utterances"

# ある議員のセルを集計する（プロファイルの cells と同じもの）
npx wrangler d1 execute civic-compass-db --remote --config api/wrangler.jsonc --command "
SELECT f.frame, t.entity, t.role, COUNT(*) n,
       ROUND(SUM(CASE f.stance WHEN 'uphold' THEN 1.0 WHEN 'override' THEN -1.0 ELSE 0 END
             * f.intensity * u.confidence * u.weight)
           / SUM(f.intensity * u.confidence * u.weight), 2) score
FROM utterance_frames f
JOIN utterance_frame_targets t ON t.frame_id = f.frame_id
JOIN utterances u ON u.utterance_id = f.utterance_id
WHERE f.speaker_id = 'P00001' AND t.role IN ('beneficiary','threat')
GROUP BY f.frame, t.entity, t.role HAVING COUNT(*) >= 3 ORDER BY n DESC LIMIT 10"

# override を含む発言を探す
npx wrangler d1 execute civic-compass-db --remote --config api/wrangler.jsonc --command "
SELECT u.politician_name, f.frame, f.evidence_text
FROM utterance_frames f JOIN utterances u ON u.utterance_id = f.utterance_id
WHERE f.stance = 'override' LIMIT 5"
```

`--remote` を `--local` にすればローカルDBを見る。

### Worker のコードから

```ts
// --- C（マッチ度API）: 全議員の profile を読んで突き合わせる ---
const ids = ["P00001", "P00002" /* … politicians.json から */];
const profiles = await Promise.all(
  ids.map((id) => c.env.PROFILES.get(`profile:${id}`, "json")),
);
// → 9人で98KB程度。evidence は読まない

// --- 上位に入った議員だけ evidence を読む ---
const evidence = await c.env.PROFILES.get(`profile:evidence:${speakerId}`, "json");
const items = evidence.cells[`${frame}|${target}|${role}`] ?? [];
for (const e of items) {
  const full = e.block_text ?? e.quote;      // 公式サイト由来なら undefined
  if (full && e.evidence_span) {
    const [s, t] = e.evidence_span;
    // full.slice(s, t) が根拠箇所。前後を含めて表示できる
  } else {
    // quotable: false。summary と url だけを見せる（§10）
  }
}

// --- B（ポップアップ）: セルから議員を逆引きする ---
// politician_name / party / distinctiveness まで入っているので、これだけで表示できる
const holders = await c.env.PROFILES.get(`cellidx:${frame}|${target}|${role}`, "json");
const top3 = holders.filter((h) => Math.sign(h.score) === Math.sign(userScore)).slice(0, 3);

// --- D1（drizzle）---
import { createDb, utterances } from "@civic-compass/db";
const db = createDb(c.env.DB);
```

**`wrangler dev` のローカル KV は空。** 動作確認するなら `--remote` を付けて起動するか、
`wrangler kv bulk put` でローカルにも入れる。

---

## データを入れ直すとき

抽出をやり直したあとの手順。順番を守ること。

```bash
# 1. evidence_text の修復（抽出中は実行できない。完了後に必ず1回）
node scripts/kokkai/repair-evidence.mjs

# 2. プロファイル生成
node scripts/kokkai/build-profiles.mjs

# 3. D1（--truncate が要る。INSERT OR IGNORE なので付けないと既存行が更新されない）
node scripts/kokkai/export-d1.mjs --in=data/utterances.jsonl --out=data/utterances.sql --truncate
npx wrangler d1 execute civic-compass-db --remote --config api/wrangler.jsonc --file=data/utterances.sql

# 4. KV（put で上書きされるのでそのまま流す）
node scripts/kokkai/export-kv.mjs
npx wrangler kv bulk put data/profiles/kv-bulk.json --binding=PROFILES --config api/wrangler.jsonc --remote
```

KV は上書きされるが、閾値変更などで**不要になったキーは残る**。
気になる場合は `data/profiles/kv-keys.json`（投入キー一覧）で
`wrangler kv bulk delete` してから入れ直す。

---

## 現在入っているデータ

**⚠️ 抽出は進行中。以下は途中経過。**

```
D1   utterances 5,906 / frames 12,870 / targets 14,745 / 議員 9人
KV   profile 9 / evidence 9 / party 4 / cellidx 112 = 134キー（11.9MB）
```

最終的には**15人・12,000セグメント前後**になる見込み。
完了後に上記の手順で入れ直すので、`speaker_id` 以外の値は変わると考えてよい。

議員の一覧と `speaker_id` の対応は `scripts/kokkai/politicians.json` が正。
`active: false` の議員（現職でなくなった2名）はプロファイルを作っていない。
