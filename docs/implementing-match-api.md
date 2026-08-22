# C: マッチ度API の実装指示書

`GET /api/match?user_id=U123` を実装するための引き継ぎ資料。

**まず [data-reference.md](./data-reference.md) を読んでください。**
D1 と KV に何が入っているか、`share` / `score` / `distinctiveness` が何を測るかが書いてあります。
本書はその上で「マッチ度をどう計算するか」に絞ります。

このアプリは**政策への賛否ではなく「正当化の論理」でマッチさせます。**
同じ「選択的夫婦別姓に賛成」でも、個人の自己決定から言う人とジェンダー平等から言う人は
別の思想である、という考え方です。マッチの単位は**セル（`frame × target × role`）**です。

---

## やること

```
① ユーザープロファイル【3】       ← ✅ 実装済み。KV から読むだけ
  ↓ ② 全議員の profile:{id} と突き合わせ（evidence は読まない。合計150KB程度）
  ↓ ③ match_score + reasons + differences を組み立て
  ↓ ④ 上位3人だけ profile:evidence:{id} を読んで根拠を添える
```

**LLM は一切使いません。** 理由文もテンプレートで作ります（後述）。

**①はすでに動いています。** 意見の保存（`POST /api/answers`）のたびに集計され、
KV `USER_PROFILES` の `profile:user:{user_id}` に入ります。C は**読むだけ**で、
リクエストのたびに集計し直してはいけません。

---

## ① ユーザープロファイル —— ✅ 実装済み

**議員と完全に同じ形です。**マッチ計算を対称にするためです。

| | |
|---|---|
| 置き場 | KV `USER_PROFILES`（議員側の `PROFILES` とは**別の名前空間**） |
| キー | `profile:user:{user_id}` |
| 更新 | `POST /api/answers` のたび |
| 集計の実体 | `shared/src/user-profile.ts` の `aggregateUserProfile()` |
| 計算式 | `shared/src/scoring.ts`（**議員側のバッチと同じものを読んでいる**） |

読み方はこれだけです。

```ts
const raw = await c.env.USER_PROFILES.get(`profile:user:${userId}`);
const user: UserProfile = raw ? JSON.parse(raw) : null;
```

以下は中身の説明です。**再実装する必要はありません**が、何が入っているかを
理解してから ② に進んでください。

```jsonc
// KV USER_PROFILES: profile:user:test_user1
{
  "user_id": "test_user1",
  "computed_at": "2026-08-22T11:41:38.349Z",
  "profile_version": "user-profile-v1.0",
  "n_answers": 1,        // 回答した記事の数
  "n_selections": 2,     // 答えた設問の数（neutral / 関心なし を含む）

  "cells": [
    { "frame": "sanctity_tradition", "target": "国民全体", "role": "beneficiary",
      "score": 1, "share": 1, "n": 1 }
  ],

  // 明示的に「関心がない」と表明したセル。cells には入れないが、マッチには使う。
  // 「まだ答えていない」セルとは区別する（後述）
  "declined_cells": [
    { "frame": "care_harm", "target": "地方", "role": "beneficiary" }
  ],

  "override_rate": 0.066,
  "override_weight": 3.718
}
```

**議員側との違いは2つだけです。**

- `distinctiveness` を**持ちません**。掛けるのは議員側の値だけ（後述）
- `declined_cells` を**持ちます**。議員側には「明示的に語らないと表明する」機会がない

`frames`（フレーム単独に畳んだもの）はユーザー側では作っていません。マッチ計算は
セル単位で行うので不要で、表示に要るなら `cells` から畳めます。

---

### 計算式（参考。実装済みなので書き直す必要はありません）

```
寄与 w = intensity × confidence × interest
         ※ 議員側の weight（答弁の本人度）にあたるものが、ユーザー側では interest（関心度 0/0.5/1）

k = min(1 + ln(1 / override率), 6.0)      ← override の稀少性重み

score = Σ(sign(stance) × w × (override ? k : 1)) / Σ(w × (override ? k : 1))
share = (そのセルのΣw + SHARE_PRIOR) / (全セルのΣw + SHARE_PRIOR × セル数)
```

`sign` は `uphold` = +1、`override` = −1、`neutral` = 0。

セルに入るのは `role` が `beneficiary` / `threat` のものだけです（`neutral` は
情報量がなく疎になるだけ）。設問側の CHECK 制約でも `neutral` は弾いています。

### ★片側だけに補正を掛けてはいけない

`score` を突き合わせる以上、**片方だけ増幅するとスケールが合いません**。
`agree = 1 - |u.score - p.score| / 2` が意味を失います。

そのため計算式は `shared/src/scoring.ts` を唯一の正とし、**議員側のバッチ
（`scripts/kokkai/build-profiles.mjs`）とユーザー側（api）が同じ関数を読んで
います**。`api` 側にコピーを作らないでください。

```
shared/src/scoring.ts
  SHARE_PRIOR = 4.0          share のベイズ平滑化
  overrideWeight(rate)       override の稀少性重み k
  MEAN_OVERRIDE_RATE = 0.066 回答が少ないうちに使う全議員平均
  distinctiveness(share, mean)
```

ユーザーは回答数が少なく override 率が不安定なので（1件でも 33% に跳ねる）、
**回答が10件未満のうちは全議員の平均（6.6%、k = 3.72）を使います**。
10件を超えたら本人の実測値に切り替わります。実装済みです。

### ★回答は3つに分ける —— 「関心がない」と「まだ答えていない」は別物

集計側（実装済み）は回答を**3つのバケツ**に分けています。**C が使うのは②の
`declined_cells` で、③との重みの差をつけるのは C の仕事です。**

| バケツ | 条件 | 扱い |
|---|---|---|
| **① 積極的に語った** | `interest > 0` かつ `stance <> 'neutral'` | `cells` に入れる |
| **② 明示的に関心がないと言った** | `interest = 0`（記事ごと）または `stance = 'neutral'`（設問ごと） | `cells` に入れない。`declined_cells` として別に持つ |
| **③ まだ答えていない** | そもそも回答が無い | 何も持たない |

②と③を混ぜてはいけません。**②のほうが情報量が大きい**からです。「この観点は自分には関係ない」と表明した人と、
たまたま出会っていない人は違います。マッチ計算では②を③より重く扱います。

```js
const SILENT_WEIGHT   = 0.3;   // ③ 両者とも持たない（たまたま一致）
const DECLINED_WEIGHT = 0.5;   // ② ユーザーが明示的に降りたセルを、議員も語っていない
```

②で「議員は語っているのにユーザーが降りた」場合は**加点しません**。分母 `den` はユーザーの
`cells`（①）の share 合計なので、②は分母にも分子にも入らず、素通りします。減点にはしないこと
（「関心がない」は反対意見ではないため）。

```js
// ② 明示的に降りたセルを、議員も語っていない → 少し加点
const declinedAgreement = user.declined_cells
  .filter((c) => !pmap.has(key(c)))
  .length / Math.max(user.declined_cells.length, 1);
num += declinedAgreement * DECLINED_WEIGHT;
```

#### ★`interest = 0` を cells に入れてはいけない（集計側は対応済み）

寄与 `w = intensity × confidence × interest` が 0 になるので無害に見えますが、**`share` は
ベイズ平滑化されている**ので 0 になりません。

```
share = (Σw + SHARE_PRIOR) / (全セルのΣw + SHARE_PRIOR × セル数)

【誤】interest = 0 の行も集計に入れた場合
   share=0.268  w=0.63  care_harm × 自然環境          ← 本当に重視している
   share=0.232  w=0.00  care_harm × 子ども・将来世代  ← 「関心がない」

【正】interest = 0 を除いてから集計した場合
   share=0.500  w=0.63  care_harm × 自然環境
```

**ほぼ同じ share になります。** しかも `den += u.share` で分母に入るので、
「関心がない」と答えたセルを持っていない議員が減点されます。意図と正反対です。

集計側はすでに落としています。**自前で集計し直すときは同じことをしてください。**

```sql
-- ① cells の元になる行
SELECT s.frame, s.target, s.role, s.stance,
       s.intensity * s.confidence * a.interest AS w
FROM answer_selections s
JOIN answers a USING (answer_id)
WHERE a.user_id = ?
  AND a.interest > 0          -- ★これが無いと上の【誤】になる
  AND s.stance <> 'neutral';  -- neutral は向きが読めないので cells に入れない

-- ② 明示的に降りたセル
SELECT DISTINCT s.frame, s.target, s.role
FROM answer_selections s
JOIN answers a USING (answer_id)
WHERE a.user_id = ?
  AND (a.interest = 0 OR s.stance = 'neutral');
```

`interest` が `answers` 側にあるので、**記事単位の関心度がその記事の全設問に効きます**。
記事に「関心がない」と答えれば、その記事の設問が指すセルはすべて②になります。

#### 注意：記事への関心と、価値への関心は別物

「このニュースには関心がない」は「`care_harm × 自然環境` という観点に関心がない」と
同じではありません。再エネの記事に興味がなくても、環境への配慮そのものは重視しているかも
しれません。`DECLINED_WEIGHT` を `SILENT_WEIGHT` より少し上に置くだけに留め、
満額にしないのはこのためです。

---

### `distinctiveness` はユーザー側では計算しない

「議員の中でどれだけ珍しいか」を測る指標なので、掛けるのは議員側の値だけです。
ユーザープロファイルにこのフィールドは**存在しません**。

---

## ② マッチ計算

```js
const key = (c) => `${c.frame}|${c.target}|${c.role}`;   // ★role を含む3要素

const MIN_N = 3;              // 議員側のセルの下限
const MIN_MATCHED = 2;        // これ未満なら reliable: false
const SILENT_WEIGHT = 0.3;    // ③ 両者とも持たない（たまたま一致）
const DECLINED_WEIGHT = 0.5;  // ② ユーザーが明示的に降りたセルを、議員も語っていない

function match(user, pol) {
  const pmap = new Map(pol.cells.map((c) => [key(c), c]));
  let num = 0, den = 0, matched = 0;
  const contrib = [];

  for (const u of user.cells) {
    // ★分母はユーザーが重視する全セル。議員が持たないセルは加点されず実質減点になる
    den += u.share;

    const p = pmap.get(key(u));
    if (!p || p.n < MIN_N) continue;

    // 両者が重視するセルほど効く。ありふれたセルは distinctiveness で割り引く
    const overlap = Math.sqrt(u.share * p.share) * Math.log(1 + p.distinctiveness);
    const agree = 1 - Math.abs(u.score - p.score) / 2;   // 0〜1

    num += overlap * agree;
    matched++;
    contrib.push({ ...u, w: overlap, agree, c: overlap * agree, polShare: p.share, polScore: p.score });
  }

  // 「両者とも語らなかったセル」も一致として少しだけ数える
  num += silentAgreement(user, pol) * SILENT_WEIGHT;

  if (matched < MIN_MATCHED) return { reliable: false };

  return {
    reliable: true,
    match_score: Math.round((num / den) * 100),
    matched_cells: matched,
    reasons: contrib.sort((a, b) => b.c - a.c).slice(0, 3),
    differences: contrib.filter((x) => x.agree < 0.5).sort((a, b) => b.w - a.w).slice(0, 2),
  };
}
```

### 式に出てくる変数の意味

| 変数 | 何を表すか | どこから来るか |
|---|---|---|
| `u` | ユーザーのセル1つ | `profile:user:{id}` の `cells[]` |
| `p` | 同じキーを持つ議員のセル | `profile:{speaker_id}` の `cells[]` |
| `u.share` | **ユーザーがそのセルをどれだけ重視しているか**（0〜1、全セル合計1.0） | 集計値 |
| `p.share` | **議員がそのセルをどれだけ語ったか**（同上） | 集計値 |
| `u.score` / `p.score` | **その価値を支持したか退けたか**（−1〜+1） | 集計値 |
| `p.distinctiveness` | **そのセルが議員の中でどれだけ珍しいか**（1.0が平均並み） | 議員側のみ |
| `p.n` | そのセルに該当したフレームの数 | 集計値。`MIN_N` 未満は使わない |
| `overlap` | **両者がともに重視している度合い**。この後 `agree` と掛ける | 計算で求める |
| `agree` | **態度の向きが揃っているか**（0〜1、1が完全一致） | 計算で求める |
| `num` | 加点の累計。**一致した分** | ループで加算 |
| `den` | **ユーザーが重視するセルの総量**。分母 | ループで加算 |
| `matched` | 共通セルの数。信頼度の判定に使う | ループで加算 |

#### `overlap` —— 両者がともに重視しているか

```js
const overlap = Math.sqrt(u.share * p.share) * Math.log(1 + p.distinctiveness);
```

**相乗平均（`sqrt(a × b)`）を使う理由**は、**どちらか一方だけが重視しているセルを効かせない**
ためです。単純平均 `(a + b) / 2` だと、ユーザーが触れていないセルでも議員側の share が
大きければ点が入り、数字が膨らみます。相乗平均なら片方が0に近ければ全体も0に近づきます。

```
u.share=0.20, p.share=0.20  → sqrt(0.04) = 0.200   両者とも重視 → 大きい
u.share=0.20, p.share=0.01  → sqrt(0.002) = 0.045  片方だけ     → 小さい
u.share=0.01, p.share=0.01  → sqrt(0.0001) = 0.010 両者とも軽い → 小さい
```

`log(1 + distinctiveness)` を掛けるのは、**ありふれたセルの一致を割り引く**ためです。
対数にしているのは、突出度が高いセルの影響が過大にならないようにするため
（2倍と4倍の差を、そのままの比率では効かせない）。

```
distinctiveness=1.0（平均並み） → log(2.0) = 0.69
distinctiveness=2.0（2倍）      → log(3.0) = 1.10   1.6倍の重み
distinctiveness=3.0（3倍）      → log(4.0) = 1.39   2.0倍の重み
```

#### `agree` —— 態度の向きが揃っているか

```js
const agree = 1 - Math.abs(u.score - p.score) / 2;
```

`score` は −1〜+1 なので、差は最大2。それを2で割って0〜1に正規化し、1から引いています。

```
u.score=+1.0, p.score=+1.0  → agree = 1.00  完全一致
u.score=+1.0, p.score= 0.0  → agree = 0.50  片方が中立
u.score=+1.0, p.score=-1.0  → agree = 0.00  正反対
```

**ただし実データでは大半のセルで `agree ≒ 1` になります**（後述）。
`agree` は「稀に現れる態度の食い違い」を捉える補正であって、主軸ではありません。

#### `num` と `den` —— なぜ分母がユーザー側なのか

```js
den += u.share;              // ← ループの先頭。議員がセルを持つかに関わらず加算
...
num += overlap * agree;      // ← 議員がセルを持つときだけ加算
```

`den` は**ユーザーが重視するセルの総量**（＝1.0に近づく）、`num` は**そのうち議員が
カバーできた分**です。したがって `match_score = num / den × 100` は
「**ユーザーが大事にしていることを、この議員がどれだけ語っているか**」を意味します。

議員が持たないセルは `den` にだけ加算されるので、**自動的に減点として効きます**。

### なぜこの式なのか

**実データを見て決めた形です。素朴な実装だと壊れます。**

#### 分母を「共通セル」ではなく「ユーザーの全セル」にする

共通セルだけを分母にすると、`match_score` が**全議員100%になります**。

```
match_score = Σ(w × agree) / Σ(w) = Σ(w × 1) / Σ(w) = 100%
```

`agree` がほぼ1に張り付くからです。**実データでは cells の8割前後が score +0.9以上**で、
負の score はごくわずかです。これは構造的な性質で、score を直しても解消しません。

- 政治家は価値を「根拠として持ち出す」（uphold）のが普通で、
  「優先順位を下げる」（override）は言語行為として稀（実測 96% : 4%）
- `role` をセルキーに入れたので、対立が別セルに分かれる。
  「外国人・移民 × threat」と「× beneficiary」は**どちらも uphold**

分母をユーザーの全セルにすると「ユーザーが重視するセルを議員がどれだけカバーしているか」
になり、議員が持たないセルが実質的な減点として効きます。

#### `distinctiveness` を掛ける

`share` だけだと「誰でも語る観点」と「その人しか語らない観点」が同じ重みになります。

```
care_harm    全議員が 16〜31%   （2倍の開き）    → 一致しても情報量が小さい
sovereignty  全議員が  2〜26%   （10倍以上の開き）→ 一致は強い意味を持つ
```

（数値は抽出の進行につれて変わります。傾向として
「`care_harm` は誰でも語る／`sovereignty` は議員で大きく割れる」を押さえてください）

#### 「両者とも語らなかった」も少しだけ数える

語らなかったこと自体が思想の情報です。ただし**満額にしてはいけません**。
セルは理論上280種（10 frame × 14 target × 2 role）あり、議員1人が持つのは
実測で数十種にとどまります。**持たないセルのほうが多い**ので、
満額で数えると誰と比べても高いマッチ度が出ます。

判定は**セル単位**で行ってください。frame レベルではほとんど差が出ません
（実測ではほぼ全議員が10種すべてを語っています）。

`profile:{id}` の `frames` には**語っていない frame も `share: 0` / `n: 0` で入っています**。
`silent_frames` に n=0 の一覧もあります。

---

## ③ reasons / differences

**寄与の分解なので LLM は不要です。** `contrib` を並べ替えるだけ。

理由文はフレーム名の日本語化テンプレートで作ります。

| frame | 日本語 |
|---|---|
| `care_harm` | 弱い立場への配慮 |
| `fairness` | 公正さ |
| `liberty_autonomy` | 個人の自由と自己決定 |
| `loyalty_community` | 共同体の結束 |
| `authority_order` | 秩序と規律 |
| `sanctity_tradition` | 伝統と尊厳 |
| `efficiency_utility` | 効率と実利 |
| `procedure_rule_of_law` | 手続きと法の支配 |
| `sovereignty` | 国の自立 |
| `evidence_expertise` | 科学と専門知 |

```js
// 例: 「子ども・将来世代について、弱い立場への配慮を重んじる点」
const text = `${cell.target}について、${FRAME_JA[cell.frame]}を重んじる点`;
```

`score` が負のセル（その価値を優先順位で下に置いた）は言い回しを変えてください。

```js
cell.score < -0.2 ? `${FRAME_JA[cell.frame]}よりも他の価値を優先する点` : `…を重んじる点`
```

---

## ④ evidence を添える

**上位3人だけ** `profile:evidence:{speaker_id}` を読みます。1件1MB前後あるので、
全議員分を読むと十数MBになります。

```js
const evidence = await env.PROFILES.get(`profile:evidence:${speakerId}`, "json");
const items = evidence.cells[`${frame}|${target}|${role}`] ?? [];
```

### ★著作権の出し分け（必須）

evidence には2種類あります。

```jsonc
// 国会会議録（公文書）— 原文を表示してよい
{ "date": "...", "summary": "...", "url": "...",
  "quote": "…", "block_text": "…", "evidence_text": "…", "evidence_span": [282, 411] }

// 議員の公式サイト（著作物）— summary と url だけ
{ "date": "...", "summary": "...", "url": "..." }
```

**`quote` が無いエントリは原文を表示しないでください。**要約とリンクに留めます。

根拠箇所のハイライトはこうします。

```js
const full = e.block_text ?? e.quote;   // 常に発言ブロック全文が得られる
const [s, t] = e.evidence_span;
full.slice(s, t)                        // → 根拠にした箇所
```

`block_text` が `null` なのは「分割していない＝`quote` がブロック全文」という意味です。

---

## レスポンス形式

```jsonc
{
  "user_id": "U123",
  "reliable": true,
  "user_summary": "個人の選択の自由と、弱い立場への配慮を重く見る傾向",
  "matches": [
    {
      "speaker_id": "P00123",
      "politician_name": "佐藤太郎",
      "party": "xx党",
      "match_score": 78,
      "matched_cells": 7,
      "reasons": [
        { "text": "個人の自己決定を重んじる点", "frame": "liberty_autonomy",
          "target": "個人", "role": "beneficiary", "contribution": 0.31 }
      ],
      "differences": [
        { "text": "共同体・伝統の重視度はこの議員のほうが低い", "frame": "loyalty_community" }
      ],
      "evidence": [
        { "date": "2024-03-12", "quote": "……原文……",
          "url": "https://kokkai.ndl.go.jp/...", "frame": "liberty_autonomy" }
      ]
    }
  ],
  "party_matches": [
    { "party": "自由民主党", "match_score": 62, "n_politicians": 4 }
  ],
  "disclaimer": "これは参考情報であり、投票の推奨ではありません。"
}
```

`reliable: false` を返す条件は、

- 共通セルが `MIN_MATCHED`（まず2で始める）未満
- または `n_answers < 5`

このときは「もう少し記事に意見を書くと精度が上がります」と表示します。

`party_matches` は `profile:party:{党名}` を読んで同じ計算をします。
**対象議員が1人の党も含めます**（プロトタイプ方針）。
大政党ほど平均で中庸に寄る点は承知の上です。

---

## やってはいけないこと

これらは議論の末に決まった制約です。破ると設計が壊れます。

### ❌ セルキーから `role` を落とす

正反対の思想が同一視されます。実データでも
`efficiency_utility × 大企業・産業` を `beneficiary` で語る議員（産業振興）と
`threat` で語る議員（既得権益批判）に分かれています。

同じ理由で、**`role` 違いを部分一致にしてもいけません。**
`target` だけ違う場合の部分一致は検討の余地がありますが、後述のとおり保留中です。

### ❌ `score` だけでマッチさせる

8割前後が +0.9以上なので**全員100%になります**。主軸は `share` です。

### ❌ 全議員の evidence を読む

`profile:{id}` は全議員合わせても100KB台ですが、`profile:evidence:{id}` は1人1MB前後です。
突き合わせに使うのは `profile:{id}` だけ。evidence は表示する分のみ。

### ❌ LLM に理由文を書かせる

政治テーマでの捏造は致命傷です。理由文はテンプレート、引用は evidence の原文をそのまま。

### ❌ ラベル（保守/リベラル/左右）で断定表示する

軸ごとの記述文で見せてください。世代でラベルの意味が異なることが実証されています。

### ❌ 出典URLを省く

`evidence[].url` は必ず併記してください。

---

## 実装するときに気をつけること

「やってはいけないこと」は設計上の禁止事項でしたが、こちらは**実装時に踏みやすい罠**です。

### KV の名前空間を間違えない

議員側は `PROFILES`、ユーザー側は `USER_PROFILES` で**別の名前空間**です。
`api/src/bindings.ts` で両方バインドしてあります。

```ts
export type Bindings = Pick<Env, "DB" | "PROFILES" | "USER_PROFILES">;
```

ローカルで参照するときは `--local --persist-to .wrangler/state` が要ります
（`data-reference.md`「ローカルとリモートは別物」）。

### `silentAgreement` の数え方

「両者とも語らなかったセル」を数えるとき、**母集団をどう取るか**で結果が変わります。

```
✗ 理論上の280種すべてを母集団にする
    → 誰も語らないセルが200種以上あり、全員が高得点になる

✓ 全議員の和集合（実測で100種強）を母集団にする
    → 「誰かは語っているのに、この2人はどちらも語らない」を数えることになる
```

和集合は `cellidx:*` のキー一覧から作れます。

```bash
npx wrangler kv key list --binding=PROFILES --config api/wrangler.jsonc --remote \
  | jq -r '.[].name | select(startswith("cellidx:"))'
```

### `den` が0になるケース

ユーザーの `cells` が空（回答はあるが価値含意が拾えなかった）だと `num / den` が
`NaN` になります。**`reliable: false` の判定を割り算より前に置いてください。**

```js
if (!user || user.cells.length === 0 || user.n_answers < 5) return { reliable: false };
```

プロファイルが KV に**無い**こともあります（まだ一度も保存していないユーザー）。
`get()` が `null` を返すので、そこも同じ分岐で受けてください。

### `MIN_N` は議員側にだけ適用する

`p.n < MIN_N` のセルは使いませんが、**ユーザー側に同じ閾値を適用してはいけません**。
ユーザーの回答は十数件しかないので、`n >= 3` を求めるとセルがほぼ残りません。

なお `profile:{id}` の `cells` は**生成時点で既に `n >= 3` に絞られています**。
それでもコード側で `p.n < MIN_N` を見ておくのは、閾値を後から変えたときの保険です。

### `share` は「その人の中での比率」であって、議員間で直接比較できない

```
議員A  care_harm × 国民全体  share=0.10
議員B  care_harm × 国民全体  share=0.10
  → 「同じくらい語っている」とは限らない。
     Aのセル数が30、Bが80なら、Bのほうが相対的に集中している
```

議員間で比べたいときは `distinctiveness` を使ってください。

### `party_matches` は議員のマッチ度の平均ではない

政党プロファイル（`profile:party:{党名}`）は**所属議員の cells を n で加重平均したもの**で、
そこに対してユーザーと同じマッチ計算をします。
「所属議員の match_score を平均する」のとは別の値になります。後者にしないでください
（1人だけ極端に高い党が過大評価されます）。

### 議員の並び順を score でソートしない

`match_score` が同点になることがあります。同点時の順序が実行のたびに変わると
ユーザーが混乱するので、**第2ソートキーに `matched_cells`、第3に `speaker_id`** を
入れて決定的にしてください。

### `active: false` の議員を除外する

`scripts/kokkai/politicians.json` に `active: false` の議員がいます（現職でなくなった人）。
プロファイルは作られていませんが、**議員一覧をハードコードせず politicians.json から
`active !== false` で絞ってください。**

### KV の読み込みは並列にする

全議員の `profile:{id}` を直列に読むと、議員数ぶんのラウンドトリップがかかります。

```js
const profiles = await Promise.all(ids.map((id) => env.PROFILES.get(`profile:${id}`, "json")));
```

`get(key, "json")` を使えばパース済みで返るので、`JSON.parse` は不要です。

### `wrangler dev` のローカル KV は空

ローカルで動かすと `PROFILES.get()` が全部 `null` を返します。

```bash
npx wrangler dev --remote        # リモートの KV / D1 を見る
```

または `wrangler kv bulk put` でローカルにも入れてください（`--remote` を外す）。

### ユーザープロファイルをリクエストのたびに作り直さない

`answers` から集計するのは軽い処理ですが、回答が増えると無駄が出ます。
`profile:user:{id}` に保存し、**回答が追加されたときだけ再計算**してください。
B（意見保存直後のポップアップ）で回答を保存するので、そこで更新するのが自然です。

## 検証のしかた

正解データはないので、**既知の立場と照合**します。

### 各議員の特徴

`distinctiveness` の上位セル。マッチ結果の妥当性を判断する材料になります。

**この表は抽出途中の値です。**最新は次のコマンドで出せます。

```bash
node scripts/kokkai/build-profiles.mjs
```

| 議員 | speaker_id | 特徴的なセルの傾向 |
|---|---|---|
| 高市早苗 | P00001 | `sovereignty`（経済安保・食料安保） |
| 河野太郎 | P00002 | `efficiency_utility` `liberty_autonomy`（規制改革） |
| 小泉進次郎 | P00003 | `loyalty_community` `procedure_rule_of_law` |
| 稲田朋美 | P00004 | `procedure_rule_of_law × 個人`（再審法・冤罪）`sanctity_tradition × 家族` |
| 小川淳也 | P00005 | `care_harm × 障害者・マイノリティ` `authority_order × 個人` |
| 階猛 | P00006 | `efficiency_utility × 中小企業` `liberty_autonomy × 外国人・移民` |
| 斉藤鉄夫 | P00007 | `× 地方`（元国交相。防災・地方交通） |
| 藤田文武 | P00008 | `liberty_autonomy × 個人`（維新の規制改革） |
| 玉木雄一郎 | P00010 | `procedure_rule_of_law` `fairness × 現役世代` |
| 榛葉賀津也 | P00011 | `sovereignty × 外国人・移民` `loyalty_community × 国際社会` |

### 受け入れテストの例

仮のユーザープロファイルを作って、期待どおりの議員が上位に来るか見ます。

```
「国産の技術を守り、外国資本に頼らない経済にすべき」
  → sovereignty × 国民全体 × beneficiary が立つ
  → 高市早苗が上位に来るはず

「障害のある人が地域で当たり前に暮らせる制度が要る」
  → care_harm × 障害者・マイノリティ × beneficiary
  → 小川淳也が上位に来るはず

「冤罪で人生を奪われることがあってはならない」
  → procedure_rule_of_law × 個人 × beneficiary
  → 稲田朋美が上位に来るはず（保守系だが人権重視という実例）
```

**全員が同じくらいのスコアになったら、分母の取り方を間違えています。**

### 動作確認用のデータ

現在 D1 と KV には**途中データ**が入っています。

最終的には**15人・12,000セグメント前後**になり、入れ直されます。
`speaker_id` 以外の値（share / score / distinctiveness / セル構成）は**変わります**。
**数値をハードコードしないでください。**

現時点の件数は次で確認できます。

```bash
npx wrangler d1 execute civic-compass-db --remote --config api/wrangler.jsonc \
  --command "SELECT COUNT(*) FROM utterances"
npx wrangler kv key list --binding=PROFILES --config api/wrangler.jsonc --remote | grep -c name
```

---

## 未決定・要判断

実装しながら判断が要る点です。

### `MIN_MATCHED` の値

`role` をキーに含めた分だけ共通セルが減ります。**まず2で始めて、実データを見て調整**してください。

### `target` 違いの部分一致を入れるか

ユーザーが `care_harm × 子ども・将来世代 × beneficiary` を持ち、議員が
`care_harm × 高齢者 × beneficiary` を持つ場合、部分点を与えるかどうか。

**まず完全一致だけで実装し、マッチが低く出すぎたら重み0.2程度で足す**方針です。

入れる場合、**`target` の分類が先に要ります。** どれを守るかで立場が変わるためです。

```
care_harm × 障害者・マイノリティ × beneficiary   → 再分配を重んじる立場
care_harm × 大企業・産業 × beneficiary          → 成長を重んじる立場
      ↑ 対立に近い。部分一致にすべきでない
```

暫定の分類案：

| カテゴリ | target |
|---|---|
| 包括 | 国民全体 / 個人 / 家族 |
| 世代 | 子ども・将来世代 / 高齢者 / 現役世代 |
| 属性による少数者 | 女性 / 障害者・マイノリティ / 外国人・移民 |
| 事業者（規模） | 中小企業 / 大企業・産業 |
| 地域・国外・環境 | 地方 / 国際社会 / 自然環境 |

同一カテゴリ内でも `高齢者 vs 現役世代`、`中小企業 vs 大企業・産業` のように
利害が対立するペアがあるので、**ペア単位の除外リストが要ります**。

この分類自体が価値判断を含みます。**マッチ計算の内部でのみ使い、
UI に「強者/弱者」といった形で出さないでください。**

### `target` の粒度に起因する既知の課題

`国際社会` が広すぎて、指す相手が違っても同じセルになります。

```
ある議員の sovereignty × 国際社会
  role=threat        「外圧」「経済的威圧」（中国などを想定）
  role=beneficiary   「同志国との連携」（G7などを想定）
```

情報は失われていない（別セルとして残る）ので**マッチ計算には実害が小さい**のですが、
`differences` で「国際社会を脅威と見ている」と表示すると、ユーザーが想像する相手と
議員が語った相手がずれます。**説明文の書き方で緩和**してください。

---

## 参考

- [data-reference.md](./data-reference.md) — D1 / KV のデータ仕様、参照コマンド
- `scripts/kokkai/build-profiles.mjs` — 議員プロファイルの集計。`overrideWeight()` /
  `calcOverrideRate()` を export しているので、ユーザー側でも同じものを使う
- `scripts/kokkai/politicians.json` — 議員マスタ。`speaker_id` と `active` フラグ
  （`active: false` の議員はプロファイルを作っていない。マッチ候補から外す）

---

## いまの状態（2026-08-22）

| 段階 | 状態 |
|---|---|
| ① ユーザープロファイル | ✅ 実装済み。保存のたびに KV `USER_PROFILES` が更新される |
| ② マッチ計算 | ❌ 未着手。`GET /api/matches/:articleId` はスタブを返している |
| ③ reasons / differences | ❌ 未着手 |
| ④ evidence | ❌ 未着手 |

`api/src/routes/matches.ts` が `api/src/data/politicians.ts` の固定値を返している
状態なので、そこを置き換える形になります。

**ローカルで試すなら議員プロファイルの投入が要ります**（既定では入っていません）。

```bash
node scripts/kokkai/export-kv.mjs
npx wrangler kv bulk put data/profiles/kv-bulk.json --binding=PROFILES \
  --config api/wrangler.jsonc --local --persist-to .wrangler/state
```
