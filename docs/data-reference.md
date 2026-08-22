# データ仕様（D1 / KV）

D1 と KV に格納されているデータの仕様。
設計の背景や「なぜそうしたか」は `docs/design-constraints.md` にある。ここでは
**何が入っていて、どう読むか**に絞る。

## 全体像

議員側とユーザー側で、同じ構造（生データ → 集計 → KV）を持つ。

```
議員側                                  ユーザー側
─────────────────────  ─────────────────────
国会会議録API / 議員の公式サイト          記事の設問への回答
        ↓ 収集・前処理・LLM抽出                  ↓ 意見の保存
【1】utterances    ──→ D1              【3a】answers      ──→ D1
        ↓ 集計（バッチ・何度でも再生成可）        ↓ 集計（保存のたび・同上）
【2】profile       ──→ KV PROFILES      【3】profile:user  ──→ KV USER_PROFILES
    evidence       ──→ KV PROFILES
    cellidx        ──→ KV PROFILES
```

| | 置き場 | バインディング | 用途 |
|---|---|---|---|
| 記事・設問・選択肢 | D1 `civic-compass-db` | `DB` | 画面に出す記事と、その争点 |
| utterances | D1 | `DB` | 抽出結果の原本。議員プロファイルの再生成元 |
| users / answers | D1 | `DB` | 回答の原本。ユーザープロファイルの再生成元 |
| profile / evidence / cellidx | KV | `PROFILES` | 議員側。バッチが一括投入する |
| profile:user | KV | `USER_PROFILES` | ユーザー側。意見の保存時に書く |

**KV 名前空間を分けているのは、議員側が `kv bulk put` で一括投入されるから。**
同居させるとバッチの事故がユーザーデータに届く範囲に入る。

マッチ計算（C）は KV だけを読む。D1 はプロファイルを作り直すときの元データ。

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

## 【0】記事と設問（D1）

### `articles`

画面に出すニュース。`body` は段落の配列を JSON 文字列で持つ。

### `article_questions` —— 記事の争点

**1設問 = `frame × target × role` のセル1つ。** ユーザーの回答をどのセルに
記録するかは、クライアントではなくこのテーブルが決める。

| 列 | 例 |
|---|---|
| `id` | `energy-2035_q1` |
| `article_id` | `energy-2035` |
| `prompt` | 発電設備が自然環境に与える影響について |
| `frame` / `target` / `role` | `care_harm` / `自然環境` / `beneficiary` |
| `intensity` / `confidence` | 0.7 / 0.9（固定値。議員側は LLM が出す） |

`role` は `beneficiary` / `threat` のみ（CHECK 制約）。`neutral` は cells に
入れないので設問にも使わない。

### `article_question_options` —— 選択肢

1設問につき `uphold` / `override` / `neutral` の3行。単一選択。

```
energy-2035_q1_uphold    uphold    生態系や景観を壊さないことを優先すべきだ
energy-2035_q1_override  override  影響はあるだろうが、それを理由に電力供給を低下させるべきではない
energy-2035_q1_neutral   neutral   特に気にならない
```

**`stance` は画面に出さない。** `uphold` / `override` は「その価値を根拠として
持ち出したか、優先順位で下に置いたか」という言語行為の分類で、政策への賛否では
ない。ラベルにすると必ず賛否と読まれるので、意味は `label_text` の文面が担う
（`docs/design-constraints.md`）。

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

## 【3a】ユーザーと回答（D1）

### `users`

`user_id` / `name` / `email`（一意）/ `last_login_at` / `created_at`。
認証はまだ無く、`email` は連絡先兼一意キーであって認証済みを意味しない。

### `answers` —— 1ユーザー × 1記事

`unique(user_id, article_id)` で1行。答え直すと上書きする
（utterances と違い書き換えを許す。UI が編集を前提にしているため）。

| 列 | 意味 |
|---|---|
| `interest` | このニュースへの関心度（0 / 0.5 / 1）。`0 <= interest <= 1` の CHECK |
| `opinion_text` | 自由記述。保存するだけで LLM 抽出は未実装 |
| `extract_version` | LLM 抽出を流したら記録。未抽出なら null |

`interest` は寄与 `w = intensity × confidence × interest` の `interest` にあたり、
議員側の `weight`（答弁の本人度）と同じ位置に入る。**記事単位の関心度が、その
記事の全設問に効く。**

### `answer_selections` —— 設問1問ぶんの回答

`frame` / `target` / `role` / `intensity` / `confidence` を `article_questions`
から**複製している**。設問のセル割り当ては後から見直す前提のもので、参照のままだと
設問を直した瞬間に過去の回答の意味が黙って変わるため。議員側で `party_at_time`
（発言時点の党籍）を持っているのと同じ理由。

`source` は `question`（設問への回答）/ `llm`（自由記述からの抽出）。後者は未実装で、
抽出した frame を行として足すだけで済むように空けてある。

```sql
-- cells の集計はこのテーブルの GROUP BY だけで済む
SELECT s.frame, s.target, s.role,
       SUM(s.intensity * s.confidence * a.interest) AS w
FROM answer_selections s JOIN answers a USING (answer_id)
WHERE a.user_id = ?
  AND a.interest > 0          -- ★「関心がない」は cells に入れない
  AND s.stance <> 'neutral'
GROUP BY s.frame, s.target, s.role;
```

---

## 【3】ユーザープロファイル（KV `USER_PROFILES`: `profile:user:{user_id}`）

**議員側と同じ形**にしてある。マッチ計算を対称にするためで、`score` / `share` の
意味がずれると `agree` が成立しない。意見の保存のたびに作り直して put する。

```jsonc
{
  "user_id": "test_user1",
  "computed_at": "2026-08-22T11:41:38.349Z",
  "profile_version": "user-profile-v1.0",
  "n_answers": 1,
  "n_selections": 2,

  "cells": [
    { "frame": "sanctity_tradition", "target": "国民全体", "role": "beneficiary",
      "score": 1, "share": 1, "n": 1 }
  ],

  // 明示的に「関心がない」と表明したセル。cells には入れないが、マッチには使う。
  // 「まだ答えていない」セルより重く扱う（DECLINED_WEIGHT > SILENT_WEIGHT）
  "declined_cells": [
    { "frame": "care_harm", "target": "地方", "role": "beneficiary" }
  ],

  "override_rate": 0.066,
  "override_weight": 3.718
}
```

**議員側との違いは2つだけ。**

- `distinctiveness` を**持たない**。「議員の中でどれだけ珍しいか」を測る指標なので、
  母集団の違うユーザーに当てると意味が壊れる。掛けるのは議員側の値だけ
- `declined_cells` を**持つ**。議員側には「明示的に語らないと表明する」機会がない

`override_rate` は回答が10件に満たないうちは全議員の平均（6.6%）を使う。本人の
実測は1件でも 33% に跳ね、`k` が実態とかけ離れるため。

集計の実体は `shared/src/user-profile.ts` の `aggregateUserProfile()`。
D1 に依存しない純粋関数なので、C からも同じものを使える。計算式（`SHARE_PRIOR`、
`overrideWeight()` など）は `shared/src/scoring.ts` が唯一の正で、**議員側の
バッチと同じものを読んでいる**。

---

## 参照方法

### ローカルとリモートは別物

`npm run dev` は**ローカル**（miniflare）を使う。書き込みは
`.wrangler/state/` の SQLite に入り、**Cloudflare のダッシュボードには出ない**。

| | 付けるオプション | 備考 |
|---|---|---|
| ローカル | `--local --persist-to .wrangler/state` | **リポジトリ直下で実行する。** `--persist-to` を省くと実行ディレクトリ直下を見にいき、空に見える |
| リモート | `--remote` | 本番。ダッシュボードに出るのはこちら |

`npm run dev:api` が `--persist-to ../.wrangler/state`（＝リポジトリ直下）を
指定しているので、参照側も同じ場所を指す必要がある。

### KV

以下は `--remote` の例。ローカルを見るときは `--remote` を
`--local --persist-to .wrangler/state` に置き換える。

```bash
# キー一覧
npx wrangler kv key list --binding=PROFILES --config api/wrangler.jsonc --remote

# 議員プロファイル
npx wrangler kv key get "profile:P00001" \
  --binding=PROFILES --config api/wrangler.jsonc --remote | python3 -m json.tool

# セル逆引き（このセルを持つ議員は誰か）
npx wrangler kv key get "cellidx:sovereignty|国民全体|beneficiary" \
  --binding=PROFILES --config api/wrangler.jsonc --remote

# ユーザープロファイル（★名前空間が違う）
npx wrangler kv key get "profile:user:test_user1" \
  --binding=USER_PROFILES --config api/wrangler.jsonc \
  --local --persist-to .wrangler/state | python3 -m json.tool

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

# ユーザーの回答を設問つきで見る（ローカル）
npx wrangler d1 execute DB --local --persist-to .wrangler/state \
  --config api/wrangler.jsonc --command "
SELECT a.article_id, a.interest, s.question_id, s.stance,
       s.frame || '×' || s.target || '×' || s.role AS cell
FROM answers a JOIN answer_selections s USING (answer_id)"
```

ローカルは `sqlite3` で直接開くほうが速い。**`npm run dev` が動いている最中に
書き込むとロックが競合する**（読むだけなら問題ない）。

```bash
DB=$(ls .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite | head -1)
sqlite3 -header -column "$DB" "SELECT * FROM answers"
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

**⚠️ 抽出は進行中。以下は 2026-08-22 時点の途中経過。**

```
抽出        4,979 / 5,859 ブロック
data/       utterances 8,559 / frames 19,325 / targets 22,641 / 議員 14人
            profiles 17MB（profile 14 / party 7 / cellidx 137）
```

最終的には**15人**になる見込み。完了後に「データを入れ直すとき」の手順で
入れ直すので、`speaker_id` 以外の値は変わると考えてよい。

議員の一覧と `speaker_id` の対応は `scripts/kokkai/politicians.json` が正。
`active: false` の議員（現職でなくなった2名）はプロファイルを作っていない。

### 投入状況

| | ローカル | リモート |
|---|---|---|
| D1 マイグレーション | `0000`〜`0003` | **`0000`〜`0001` のみ** |
| 記事 8本 | ✅ | ✅ |
| 設問 15問 / 選択肢 45 | ✅ | ❌（`0002` 未適用） |
| users / answers | ✅（`test_user1` のみ） | ❌（`0003` 未適用） |
| utterances | ❌ | ✅（抽出途中のもの） |
| KV `PROFILES`（議員側） | ❌ | ✅（抽出途中のもの） |
| KV `USER_PROFILES` | ✅（空） | ✅（空） |

**リモートに設問とユーザーのテーブルが無い。** デプロイや `wrangler dev --remote`
を使うなら、先に `npm run db:migrate:remote` が要る。

ローカルで議員プロファイルを使いたい場合（マッチ計算の動作確認など）は投入する。

```bash
node scripts/kokkai/export-kv.mjs
npx wrangler kv bulk put data/profiles/kv-bulk.json --binding=PROFILES \
  --config api/wrangler.jsonc --local --persist-to .wrangler/state
```
