# C: マッチ度API の実装指示書

`GET /api/match?user_id=U123` を実装するための引き継ぎ資料。

**まず [data-reference.md](./data-reference.md) を読んでください。**
D1 と KV に何が入っているか、`share` / `score` / `distinctiveness` が何を測るかが書いてあります。
本書はその上で「マッチ度をどう計算するか」に絞ります。

このアプリは**政策への賛否ではなく「正当化の論理」でマッチさせます。**
同じ「選択的夫婦別姓に賛成」でも、個人の自己決定から言う人とジェンダー平等から言う人は
別の思想である、という考え方です。マッチの単位は**セル（`frame × target × role`）**です。

### B（意見保存直後のポップアップ）とは別物です

`GET /api/perspectives/:articleId` は**実装済み**（`api/src/routes/perspectives.ts`）。
名前が似ていますが、見せるものが違うので混同しないでください。

| | B `/api/perspectives/:articleId` | C `/api/match` |
|---|---|---|
| 入力 | **直前に答えた1記事の回答**（D1 `answer_selections`） | 累積のユーザープロファイル（KV `profile:user:*`） |
| 逆引きの単位 | **frame × target**（`role` では絞らない） | セル（frame × target × role） |
| 読む KV | `cellidx:*` → 論点ごとに選んだ3人の `profile:evidence:*` | 全議員の `profile:*` のみ（**evidence は読みません**） |
| 出すもの | 論点ごとに「議員がその観点をどう扱ったか」＋発言原文 | マッチ度（%）＋ reasons / differences |
| マッチ度 | **出しません** | 出します |

B はユーザープロファイルを読みません。累積で見るのは C の役割です。

### B が `role` で絞らない理由と、その代わりにやること

B は「合う意見だけを集める」画面ではなく、**同じ観点をめぐる発言を立場ごと並べて見せる**
画面なので、逆引きは `beneficiary` と `threat` の両方を読んで束ねます。

**ただし `role` を表示から消してはいけません**（`docs/design-constraints.md`「禁止事項」）。
`care_harm × 外国人・移民 × beneficiary`（支援すべき）と `× threat`（治安上の懸念）は
正反対の思想なので、B ではどちらの立場かを議員カードに必ず出し、
回答との向きの比較（`alignment`）も **`role` が一致する発言でだけ**行います。
`role` 違いで score の符号だけを見ると、正反対の思想が「同じ向き」になります。

**C ではこの緩和をしないでください。** マッチ計算で `role` を畳むのは禁止です。

### 見せる議員の選び方（B のみ）

論点ごとに3人。「似た立場」と「異なる立場」を最低1人ずつ入れ、残りの枠は
**人数の多いほう**から埋め、同じ条件の中ではランダムに選びます。
同じ議員は1論点に2枚出しません（`role` 違いで両方の側に載ることがあるため）。

**片方の立場しか無い論点は2人まで**にします。対比が作れないので、
同じ立場の議員を3人並べても読み取れることが増えないためです。

#### ★立場は「符号」ではなく「その論点の中での近さ」で分ける

素朴に `score` の符号で分けると**候補が全員同じ側に寄ります。**
議員側の `score` は97%が +0.9以上だからです（`docs/data-reference.md`）。
実データで数えると、符号が割れる設問は15問中 **2問だけ**でした。

```
efficiency_utility × 国民全体   14人全員が score 正（+0.389 〜 +1.000）
care_harm × 自然環境            beneficiary 9人が全員 score +1.000
```

そこで**回答との近さ**を出し、その論点での**最大と最小の中点**で二分します。

```js
closeness = 1 - |userSign - score| / 2      // マッチ計算の agree と同じ式
role が違う発言は closeness = 0            // 設計上「正反対の思想」なので最も遠い

middle = (max + min) / 2
closeness > middle → 似た立場 / < middle → 異なる立場
```

最大値の議員は必ず「似た立場」、最小値の議員は必ず「異なる立場」に入るので、
**両方が必ず1人以上**になります。同じ近さの議員が別のラベルになることもありません。
これで15問中11問が二分できます。

#### 分けられない論点は分けない（`positionsDivided: false`）

残る4問は**候補の全員がまったく同じ扱い方**をしていました。

```
care_harm × 子ども・将来世代   13人全員 score +1.000
care_harm × 高齢者            10人全員 score +1.000
care_harm × 地方              12人全員 score +1.000
loyalty_community × 家族        5人全員 score +1.000
```

ここに差を作るのは捏造なので、`positionsDivided: false` を返して
画面に「この観点では、議員の立場に違いがありませんでした」と出し、
議員も**2人まで**に減らします。

---

## やること

```
① ユーザープロファイル【3】       ← ✅ 実装済み。KV から読むだけ
  ↓ ② 全議員の profile:{id} と突き合わせ（evidence は読まない。合計150KB程度）
  ↓ ③ match_score + reasons + differences を組み立て
```

**④ evidence は読みません**（2026-08-23 の決定。理由は後述の「④」）。

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
         ※ 議員側の weight（答弁の本人度）にあたるものが、ユーザー側では interest（関心度 0/0.33/0.66/1）

k = min(1 + ln(1 / override率), 6.0)      ← override の稀少性重み

score = Σ(sign(stance) × w × (override ? k : 1)) / Σ(w × (override ? k : 1))
share = (そのセルのΣw + PRIOR) / (全セルのΣw + PRIOR × セル数)
         ※ PRIOR は寄与のスケールに合わせて側ごとに変える
           議員   SHARE_PRIOR      = 4.0   （1セルあたりの寄与が 3〜14 なので同程度）
           ユーザー USER_SHARE_PRIOR = 0.5   （1回答の寄与が ≦0.63 しかないため）
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
  SHARE_PRIOR = 4.0          share のベイズ平滑化（議員側）
  USER_SHARE_PRIOR = 0.5     同上（ユーザー側）。★ここだけは側ごとに値が違う
  overrideWeight(rate)       override の稀少性重み k
  MEAN_OVERRIDE_RATE = 0.066 回答が少ないうちに使う全議員平均
  distinctiveness(share, mean)
```

#### ただし `share` の擬似寄与だけは側ごとに変える

上の「片側だけに補正を掛けるな」は **`score` の話**です。`agree` は
`1 - |u.score - p.score| / 2` と**差**を取るので、スケールが揃っていないと壊れます。

`share` は事情が違います。`sqrt(u.share × p.share)` という**積**で、しかも
両側とも合計 1.0 の分布なので、擬似寄与を別々に持っても突き合わせは壊れません。
むしろ**同じ値にすると壊れます**。擬似寄与は実データと同じ単位なので、

```
議員    1セルあたりの寄与 3〜14        → PRIOR 4.0 は同程度。ほどよく効く
ユーザー 1回答の寄与 0.7 × 0.9 × interest ≦ 0.63
                                      → PRIOR 4.0 だと擬似寄与が実データを押し切る
```

現行の設問カタログ（8記事15設問）は**セルの重複が1つもない**ので、ユーザーのセルは
必ず `n = 1` になります。share の差を作れるのは `interest` だけで、生の比は最大 2:1
（`0.63` 対 `0.315`）。ここに 4.0 を当てると関心度が数値に出てきません。

| PRIOR | share 最大/最小 |
|---|---|
| 4.0（議員側と同じ） | **1.07倍** ← 関心度スライダーが事実上死ぬ |
| 1.0 | 1.24倍 |
| **0.5（採用）** | 1.39倍 |
| 0 | 2.00倍（interest の生の比） |

値は議員側と同じ比率（`PRIOR ÷ 1セルあたりの寄与 ≒ 0.5〜1.3`）から。到達可能な寄与が
0.315〜0.63 なので導出値は 0.3〜0.4 で、記事が増えてセルが重複し始めたときに効きすぎない
よう 0.5 に寄せている。

#### この値は記事数・議員数が増えても変えなくてよい（実測）

- **セル数に不変**。2 → 100 に増やしても share 比は 1.387倍 のまま。合計寄与が
  `セル数 × 平均寄与` で増えるので、比からセル数が消える
- **回答が積み上がれば自然に薄れる**。同じセルの `n` が増えると 1.56倍（n=2）→
  6.02倍（n=10）と生の比に近づく。事前分布は固定値のままデータに押されるのが正しい
  振る舞いなので、データ量でスケールさせてはいけない
- **議員数と無関係**。ユーザー側の `share` は議員データを一切参照しない

見直しが要るのは**1回答あたりの寄与そのものを変えたとき**だけ（設問ごとに `intensity`
を変える、`interest` の刻みを変える等）。目安は `PRIOR ÷ 1回答の寄与 ≒ 0.8`。

#### ⚠ ただし現時点で順位はほとんど動かない

実データ15人に当てた結果、関心のある記事だけ答えた2人の差は
**平均 6.3pt（PRIOR 4.0）→ 6.8pt（PRIOR 0.5）** でした。

```
PRIOR 4.0   Aさん(子育て・介護) 稲田朋美 47 斉藤鉄夫 43 / Bさん(エネ・交通) 小泉進次郎 48 斉藤鉄夫 48
PRIOR 0.5   Aさん               稲田朋美 47 斉藤鉄夫 42 / Bさん             小泉進次郎 49 斉藤鉄夫 48
```

いま順位を決めているのは `share` の重みではなく **どのセルを持っているか**（＝どの記事に
答えたか）と `score`（どの言い分を選んだか）です。全記事に答えた2人だと、prior を 0 に
しても差は 1.3pt しか出ませんでした。

関心度をもっと効かせたいなら prior ではなく、**同じセルを複数記事で問う**（回数で言及度が
積み上がる）か、**`interest` の刻みを広げる**（0/0.3/1 なら生の比 3.3:1）のどちらかが本筋。

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
const SILENT_WEIGHT   = 0.05;  // ③ 両者とも持たない（たまたま一致）
const DECLINED_WEIGHT = 0.10;  // ② ユーザーが明示的に降りたセルを、議員も語っていない
const ABSENCE_WEIGHT  = 0.3;   // ① ユーザーが優先順位を下げたセルを、議員が語っていない（後述）
const OPPOSITE_ROLE_WEIGHT = 1;  // ★逆の role で強く語っている＝思想の対立。減点する
const STRONG_SCORE = 0.5;        // 「強く語った」の閾値。ユーザー側・議員側で同じ値
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
share = (Σw + USER_SHARE_PRIOR) / (全セルのΣw + USER_SHARE_PRIOR × セル数)

【誤】interest = 0 の行も集計に入れた場合
   share=0.693  w=0.63  care_harm × 自然環境          ← 本当に重視している
   share=0.307  w=0.00  care_harm × 子ども・将来世代  ← 「関心がない」

【正】interest = 0 を除いてから集計した場合
   share=1.000  w=0.63  care_harm × 自然環境
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
const SILENT_WEIGHT = 0.05;   // ③ 両者とも持たない（たまたま一致）
const DECLINED_WEIGHT = 0.10; // ② ユーザーが明示的に降りたセルを、議員も語っていない
const EMPHASIS_SCALE = 2;     // 突出度を「一致の強さ」に直す倍率（後述）
const ABSENCE_WEIGHT = 0.3;   // ① ユーザーが下げたセルを、議員が語っていない

// 沈黙をどれだけ信用するか。公約は網羅的なので満額、答弁は観測量に応じて割り引く
const ABSENCE_FULL_FRAMES = 1200;
const absenceConfidence = pol.source === "manifesto" || pol.source === "mixed"
  ? 1
  : Math.min(1, pol.cells.reduce((t, c) => t + c.n, 0) / ABSENCE_FULL_FRAMES);

function match(user, pol) {
  const pmap = new Map(pol.cells.map((c) => [key(c), c]));
  let num = 0, den = 0, matched = 0;
  const contrib = [];

  for (const u of user.cells) {
    // ★分母はユーザーが重視する全セル。議員が持たないセルは加点されず実質減点になる
    den += u.share;

    const p = pmap.get(key(u));
    if (!p) {
      // ★語っていないセルは score -1（優先順位を下げた）とみなして突き合わせる
      num += u.share * ABSENCE_WEIGHT * absenceConfidence * (1 - Math.abs(u.score - (-1)) / 2);
      continue;
    }
    if (p.n < MIN_N) continue;

    // ★重みはユーザーの share、強さは突出度。相手の share は直接掛けない（後述）
    const overlap = u.share * Math.min(1, Math.log(1 + p.distinctiveness) * EMPHASIS_SCALE);
    const agree = 1 - Math.abs(u.score - p.score) / 2;   // 0〜1

    num += Math.min(overlap * agree, u.share);   // 1セルは自分の share を超えて稼がない
    matched++;
    contrib.push({ ...u, w: overlap, agree, c: overlap * agree, polShare: p.share, polScore: p.score });
  }

  // 「両者とも語らなかったセル」も一致として少しだけ数える。
  // ★ただし**偶然の一致を差し引く**（薄いプロファイルが自動的に稼ぐのを防ぐ）
  const coverage = [...universe].filter((k) => pmap.has(k)).length / universe.size;
  const kappa = (obs) => Math.max(0, Math.min(1, (obs - (1 - coverage)) / coverage));
  num += kappa(silentAgreement(user, pol)) * SILENT_WEIGHT;
  den += SILENT_WEIGHT;   // ★重み付き平均にする。分母に入れるのでスコアは 0〜100 に収まる

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

#### `overlap` —— ユーザーの重み × 相手の突出度

```js
const overlap = u.share * Math.log(1 + p.distinctiveness);
```

**★相手の `share` を直接掛けてはいけません。** `share` は「その人の全セル中の比率」なので、
**セルの少ない相手ほど1セルあたりが大きく出ます**。実測で 29セルの安野貴博と 83セルの神谷宗幣
では、同じ言及量でも share が3倍近く違います。

`distinctiveness`（＝全議員平均に対する倍率）はセル数の影響を受けないので、これで測ります。
自己再現テスト（後述）で決定的な差が出ました。

| 式 | 1位的中 | 上位3 | 平均順位 | セル数との相関 |
|---|---:|---:|---:|---:|
| `sqrt(u.share × p.share) × log(1+d)`（旧） | 6/15 | 7/15 | 4.80 | **+0.61** |
| コサイン型 `u.share × p.share / ‖p‖` | 5/15 | 9/15 | 5.07 | +0.65 |
| **`u.share × log(1+d)`（採用）** | **8/15** | **13/15** | **2.53** | **−0.04** |

「セル数との相関」は、**そのプロファイルのセル数と、誰の回答に対しても得られる平均順位**の
相関です。**0 に近いほど「データ量ではなく思想で並んでいる」**ことを意味します。

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

### ★式を変えたら必ず自己再現テストで測る

`scripts/` には入れていませんが、検証は次の手順で再現できます。**議員・政党本人の
プロファイルから「本人が設問カタログに回答したら」を合成し、本人が1位に返るかを測る**
ものです（ユーザープロファイルは実際の `aggregateUserProfile` を通すので、
平滑化も override 補正も本番と同じ）。

```
① KV から profile:{id} / profile:party:{名} / cellidx:* を取る
② 各プロファイルの cells を設問カタログに突き合わせ、
   score > 0.2 なら uphold、< -0.2 なら override、無ければ interest 0（関心なし）で回答を作る
③ aggregateUserProfile → calculateProfileMatch で全員と照合し、本人の順位を見る
```

見るべき指標は4つです。

| 指標 | 意味 | 目標 |
|---|---|---|
| 1位的中 | 本人が1位に返った割合 | 高いほどよい |
| 平均順位 | 偶然なら (n+1)/2 | 小さいほどよい |
| **セル数との相関** | プロファイルのセル数と「誰の回答に対しても得る平均順位」の相関 | **0 に近いほどよい**（データ量ではなく思想で並んでいる） |
| 100%飽和 | クリップされた件数 | 0 |

実測の推移（議員15人・政党8党）。

```
                          1位的中   上位3    平均順位   セル数との相関   100%飽和
着手前                     6/15    8/15     4.47      +0.83       1.3件/回
偶然一致の差し引き            6/15    7/15     4.80      +0.61       1.3件/回
overlap を突出度ベースに      8/15   13/15     2.53      -0.04       0件
重み付き平均（分母に重みを追加）   〃      〃        〃          〃         0件
設問カタログを15問→24問に    11/15   14/15     1.67      -0.04       0件

政党                       4/8     7/8      1.75（偶然 4.5）
```

**設問カタログの寄与が最も大きい**（8/15 → 11/15）。式をいくら詰めても、
聞いていない論点は識別できません。神谷宗幣（主軸が `sovereignty`）は
13位 → **1位**になりました。

#### ★スコアの水準を合わせる（`EMPHASIS_SCALE` と重みの縮小）

本人が設問に回答したケースの平均が **53.4%** しかありませんでした。分解すると原因は2つで、
どちらも**取れない点を分母に置いていた**ことによります。

```
平均 agree            0.955   ← 向きは正しく一致している
平均 log(1+突出度)      0.700   ← 完全一致でもセルの share の7割しか取れない
κ沈黙                 0.19    ← 重み 0.3 を分母に入れても 0.06 しか返ってこない
κ関心なし              0.53    ← 同じく重み 0.5
```

```js
const overlap = u.share * Math.min(1, Math.log(1 + p.distinctiveness) * EMPHASIS_SCALE);
SILENT_WEIGHT   0.3 → 0.05
DECLINED_WEIGHT 0.5 → 0.10
```

`EMPHASIS_SCALE = 2` で、突出度が平均並み（1.0倍）のセルが満点に届きます。
平均より下のセルだけが割り引かれます。本人平均 **53.4% → 84%**、
1位的中 11/15 → 12/15、上位3 14/15 → **15/15**。

⚠ **上げるほど「そのセルを持っているか」で決まる**ので、発言量の多い相手が有利になります。
実測でセル数と平均順位の相関は 1.0倍で −0.04、1.44倍で −0.30、**2.0倍で −0.56**。
新人議員の不利を抑えたいなら 1.44 に落とす（本人平均71%）という選択もあります。

#### ⚠ 「思想が対極の相手ほど低く出る」は、式では達成できない

本人80%以上・対極30%以下を狙って4つの測り方を試しましたが、**どれも本人と対極の差が
8〜10ptしか開きません**。入力に差が無いからです。

```
神谷宗幣 vs 天畠大輔   両者が答えた19問のうち、向きが違うのは 0問
高市早苗 vs 田村智子   両者が答えた19問のうち、向きが違うのは 0問
議員の回答内訳: uphold 79.2% / override 1.4% / 未観測 19.4%
```

いまの設問は「子どもを守るべきか」のように**全員が uphold する論点**ばかりです。
向きが割れるセル（`authority_order × 個人` は13人中8人が override など）を設問にすると、
**対極平均 72% → 17%、1位的中 14/15** まで変わります。式ではなく設問の問題です。

#### ★「両者とも語らなかった」は偶然の一致を差し引く

```js
const coverage = [...universe].filter((k) => pmap.has(k)).length / universe.size;
const kappa = (obs) => Math.max(0, Math.min(1, (obs - (1 - coverage)) / coverage));
num += kappa(silentAgreement) * SILENT_WEIGHT;
num += kappa(declinedAgreement) * DECLINED_WEIGHT;
```

素の一致率をそのまま使うと、**セルの少ない相手が自動的に高く出ます**。ユーザーが何を選ぼうと
大半のセルを持たないからです。実測では**セル数と平均順位の相関が +0.83**で、
安野貴博（29セル）が誰の回答に対しても平均2.9位、神谷宗幣（83セル）が14.4位という、
思想ではなくデータ量を測る状態になっていました。

偶然の一致率は「相手が universe をどれだけ覆っていないか」＝ `1 - coverage`。
Cohen のκと同じ形で差し引きます。

#### ★スコアは重み付き平均にする（100%張り付きの解消）

```js
den = Σ u.share + SILENT_WEIGHT + DECLINED_WEIGHT     // 加点の上限を分母に入れる
num = Σ min(overlap × agree, u.share) + κ(...) × W    // 1セルは自分の share が上限
```

以前は分子が分母を超えることが多く、**1回の照合あたり平均1.3人が100%に張り付いて**
順位が付きませんでした（「小川淳也の回答 → 高市100.0 / 河野100.0 / 小川100.0」）。
上限を分母に入れ、セルごとの寄与を頭打ちにすると、構造上 0〜100 に収まります。
実測の最高スコアは 74.8 で、飽和は0件になりました。

`SILENT_WEIGHT` / `DECLINED_WEIGHT` は**該当するセルがあるときだけ分母に足します**。
「関心がない」と答えたことが一度もないユーザーの分母を、無関係に膨らませないためです。

#### ★逆の `role` で強く語っている相手は減点する（`OPPOSITE_ROLE_WEIGHT = 1`）

同じ `frame × target` を、ユーザーとは**逆の role** で強く語っている相手を減点します。
`beneficiary`（守る対象）と `threat`（脅威）は思想の対立だからです。

```js
// ユーザー: care_harm × 外国人・移民 × beneficiary（守るべき）
// 議員　　: care_harm × 外国人・移民 × threat      （治安上の懸念）
const opposite = pmap.get(`${u.frame}|${u.target}|${u.role === "beneficiary" ? "threat" : "beneficiary"}`);
if (u.score > STRONG_SCORE && opposite && opposite.score > STRONG_SCORE) {
  num -= Math.min(u.share * Math.log(1 + opposite.distinctiveness), u.share) * OPPOSITE_ROLE_WEIGHT;
}
```

重みは一致と同じ 1.0。「守る対象として語った量」と「脅威として語った量」が釣り合えば
相殺されます。**これは観測された発言なので `differences` に出して構いません**
（語っていないセルとの違いに注意）。

##### 閾値は両側とも `STRONG_SCORE = 0.5`

**片側だけ基準を変えないこと**（`override` の重みや `share` の平滑化と同じ理由）。

議員・政党の score は実測1,593セルで **25%点 +0.82・中央値 +1.00**、
0.5 を超えるものが 81.6%。0.5 未満に残るのは override を含む「向きの読めない」帯です。

**閾値を外すと、脅威の枠組みを持ち出したうえで退けた発言まで減点に数えます。**
実測では猪瀬直樹の `loyalty_community × 地方 × threat` が score −1.00 で、
これを減点すると 1.4pt ぶん不当に下がります。

ユーザー側は設問1つにつき1セルなので score は ±1 になりますが、
同じセルを複数記事で問うようになれば中間値が出ます。そのときも同じ 0.5 で切ります。

##### 発生頻度と効き方

同じ `frame × target` の両ロールを持つ相手は **7.7%**（1,479組中114組）と多くありませんが、
効くときは大きく効きます。

```
神谷宗幣  sovereignty × 外国人・移民 × threat  share 0.030 n=67  → 7.3pt の減点
田村智子  fairness    × 大企業・産業 × threat  share 0.040 n=84  → 8.3pt の減点
```

実測のユーザーでは 斉藤鉄夫 45.8 → 43.6、高市早苗 43.3 → 41.3、
自由民主党 31.5 → 30.2 と動き、順位も入れ替わりました。

#### ★語っていないセルは「優先順位を下げた」とみなす（`ABSENCE_WEIGHT = 0.3`）

議員・政党が**一度も語っていない**セルを、`score = -1` の仮想セルとして突き合わせます。
ユーザーが優先順位を下げたセル（`override`）なら一致、重んじたセルなら寄与ゼロです。

これが無いと、**ユーザーの `override` 回答がどの相手にも効きません**。議員側の score は
9割方 +1 に張り付く（override が稀）ので、相手が語っていれば必ず `agree = 0`、
語っていなければ寄与ゼロ、のどちらかにしかならないためです。実測のユーザーで
11セル中4セルがこれに当たり、分母の36%が全相手に対して死んでいました。

**公約はとくにこの読み方が効きます。** 公約は網羅的に掲げるものなので、
載せていない＝明示的に優先順位を下げた、と読めるからです。

##### 観測量で割り引く（`ABSENCE_FULL_FRAMES = 1200`）

補正しないと、**観測の少ない相手ほど有利**になります。語っていないセルが多いほど
加点を集めるためです。実測では安野貴博（Σn=306）が4位→2位に飛び、
斉藤鉄夫（Σn=1427）が3位→5位に落ちました。

```
absenceConfidence = source が manifesto / mixed        → 1（公約は網羅的なので満額）
                    それ以外（答弁データ）             → min(1, Σn / 1200)
```

`n_segments_valued` ではなくセルの `Σn` を使います。**政党プロファイルの
`n_segments_valued` は所属議員から集計した党では 0 になる**ためで、
`Σn` なら議員・政党のどちらでも同じ意味を持ちます。1200 は議員の実測
（306〜2616、中央値1364）の中央値付近です。

**`reasons` / `differences` には出しません。** 観測された発言ではないので、
「この議員は◯◯を優先していない」と画面で断定すると「推論でタグを付けない」に触れます。

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

## ④ evidence は読みません（2026-08-23 決定）

**政治コンパス画面は発言の原文を出さないので、C は `profile:evidence:*` を一切読みません。**
氏名・所属・マッチ度・reasons / differences だけで画面が成立しており、読んでも捨てるだけでした。
やめたことで、並べる議員を3人から**7人**に増やしても KV の読み込み量は変わりません。

原文が要るのは B（`GET /api/perspectives/:articleId`）です。C に「根拠を見る」UI を
足すときは、この節を復活させるのではなく**選ばれた議員1人分だけを読む別経路**にしてください
（1件1MB前後あるので、7人分をまとめて展開すると Worker のメモリに響きます）。

以下は B と、将来 C で原文を出すときのための記述です。

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
        { "text": "共同体・伝統の言及度はこの議員のほうが低い", "frame": "loyalty_community" }
      ]
    }
  ],
  "party_matches": [
    { "party_id": "PT01", "party": "自由民主党", "short_name": "自民",
      "website": "https://www.jimin.jp/", "seats": { "shugiin": 316, "sangiin": 101 },
      "source": "mixed", "match_score": 62, "matched_cells": 5, "n_politicians": 4,
      "reasons": [], "differences": [] }
  ],
  "disclaimer": "これは参考情報であり、投票の推奨ではありません。"
}
```

`reliable: false` を返す条件は、

- 共通セルが `MIN_MATCHED`（まず2で始める）未満
- または `n_answers < 5`

このときは「もう少し記事に意見を書くと精度が上がります」と表示します。

`party_matches` は `profile:party:{党名}` を読んで同じ計算をします。対象は
**国会に議席を持つ全政党**で、一覧は `scripts/kokkai/parties.json` が正です。
返すのは議員と同じく**上位7件**まで（`MAX_MATCHES`）。プロファイルが無い党と
`reliable: false` の党は、その前に落ちます。
議員マスタから所属党を数え上げないでください（プロファイルを作った15人がいない党が落ちます）。

政党プロファイルは**公約を主・所属議員の発言を従**にして作ってあります（`source` を参照）。
`profile:party:{党名}` が KV に無い党は、まだ公約を抽出していないだけなので黙って飛ばします。

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

政党プロファイル（`profile:party:{党名}`）は**各党の公約と所属議員の cells を混ぜたもの**で、
そこに対してユーザーと同じマッチ計算をします。
「所属議員の match_score を平均する」のとは別の値になります。後者にしないでください
（1人だけ極端に高い党が過大評価されます）。

政党側の `distinctiveness` は**全政党の中での珍しさ**で、議員側（議員15人の中での珍しさ）
とは母集団が違います。**議員のマッチ度と政党のマッチ度を並べて優劣を語らないこと。**
画面でもタブを分けています。

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

### `match_score` の絶対値は回答量・議員数で動く（未対処）

**順位ではなく％そのものが動きます。** UI に「マッチ度 62%」と出す以上、記事や議員を
足した時点で数字が変わることを承知しておいてください。

#### まず前提：回答が増えると精度は**本当に**上がる

同一人物（思想は固定）が答える記事の数だけを変え、全8記事の結果を「真の答え」として
部分回答と比べました（8記事の全部分集合256通りを全数探索）。

```
記事数 | 1位候補の%平均 | 最下位候補の%平均 | 差(識別力) | 真の1位を当てた率
     1 |           13.4 |              18.8 |       -5.4 |      0%
     2 |           41.6 |              26.8 |       14.8 |     39%
     4 |           50.1 |              31.8 |       18.3 |     40%
     6 |           56.7 |              35.7 |       21.0 |     57%
     8 |           62.0 |              39.0 |       23.0 |    100%
```

識別力は 14.8 → 23.0pt に単調増加し、真に一番近い議員を1位に当てられる率は 0% → 100%。
記事1本だけだと**正しい相手ですら 13.4%（真の値は 62%）に下振れ**します。
`MIN_ANSWERS` のゲートと「もう少し記事に意見を書くと精度が上がります」の案内は
データに裏づけられています。

#### 問題は「合わない議員のスコアも一緒に上がる」こと

上の表で最下位候補も 26.8% → 39.0% に上がっています。回答をさらに増やすと
（120セルまで拡張した実験）：

```
回答セル数 | 1位 | 最下位 | 差(識別力) | 15人平均
         5 |  23 |      1 |         22 |     12.7
        20 |  27 |     15 |         12 |     22.3
        60 |  42 |     29 |         13 |     34.0
       120 |  53 |     39 |         14 |     45.6
```

分布全体が上にスライドします。つまり `match_score` は **「思想の近さ」と「回答量」を
混ぜた数字**です。ここから言えることは2つ。

- **1人のユーザーの中で議員を比較するのは正しい。** 順位も識別力も回答が増えるほど良くなる
- **ユーザーをまたいだ比較と、％の絶対値の読みは信用できない。** 8本答えた人の 62% と
  30本答えた人の 62% は意味が違う

原因は、分母 `Σ u.share` が平滑化の性質上**常に 1.0** になる一方、分子の
`Σ sqrt(u.share × p.share)`（Bhattacharyya係数）は、**議員側の share が
「ユーザーが訊かれていないセル」にも広がっている**ぶん小さく出ることです。
回答が少ないほど議員の分布のごく一部としか重ならず、`未観測` が `不一致` として
数えられます。

#### 議員数でも動く

同じユーザー・同じ回答で議員数だけ変えた実測：

```
議員 4人  universe  90  1位 稲田朋美 53  中央 44  最大 distinctiveness 2.31
議員 8人  universe 112  1位 稲田朋美 57  中央 47  最大 distinctiveness 2.83
議員15人  universe 150  1位 稲田朋美 62  中央 51  最大 distinctiveness 5.71
```

`distinctiveness = (share + PRIOR) / (全議員の平均share + PRIOR)` の母集団が増えると
倍率が尖り、`log(1 + distinctiveness)` を通じて分子が膨らみます。1位は変わりませんが
％は動きます。

#### 直すなら

**設問済みのセルに土俵を制限して、議員側の share を再正規化する**のが有効でした。
ユーザーが訊かれていないセルを両者から外し、その中での配分の似方だけを比べます。

```js
const asked = new Set(user.cells.map(cellKey));        // declined_cells も含める
const mass = [...asked].reduce((a, k) => a + (pmap.get(k)?.share ?? 0), 0);
const pShare = pmap.get(k).share / mass;               // ← 再正規化
```

実測（上と同じ120セルの実験）：

```
             現行                     案C（再正規化）
回答セル数 | 1位 | 最下位 | 平均  |  1位 | 最下位 | 平均
         5 |  23 |      1 | 12.7  |   79 |     21 | 55.0
        20 |  27 |     15 | 22.3  |   80 |     44 | 65.5
        60 |  42 |     29 | 34.0  |   75 |     54 | 64.9
       120 |  53 |     39 | 45.6  |   72 |     53 | 63.4
```

平均が 12.7 → 45.6（3.6倍）だったのが 55.0 → 63.4（1.15倍）に収まります。

**ただし副作用があります。**

- 回答が少ないときに**過信**する（5セルで 79%）。現行は逆に過小評価する。
  どちらにせよ `reliable` のゲートは必要で、案Cのほうがゲートを厳しくする必要がある
- 「そもそもその話題を語らない議員」の扱いが変わる。設問済みセルでの**配分の形**だけを
  見るので、ユーザーの関心事をほとんど語らない議員でも形が似ていれば高く出る。
  必要なら `mass`（議員がその話題に割いている比重）を係数として掛ける
- `silentAgreement`（両者とも語らないセルの一致）は土俵の外になるので、
  併用するなら意味を定義し直すこと。`declined_cells` は設問済みなので土俵の中に残る

分子を「到達可能な最大値」で割るだけの案も試しましたが、平均 16.6 → 62.7 と
**改善しませんでした**（議員側の share が土俵の外に広がっている問題に触れないため）。

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
| ② マッチ計算 | ✅ 実装済み。`GET /api/matches/profile`（議員・政党とも上位7件） |
| ③ reasons / differences | ✅ 実装済み |
| ④ evidence | — この画面では出さないため**実装しません**（上記④） |

`api/src/routes/matches.ts` が `api/src/data/politicians.ts` の固定値を返している
状態なので、そこを置き換える形になります。

**ローカルで試すなら議員プロファイルの投入が要ります**（既定では入っていません）。

```bash
node scripts/kokkai/export-kv.mjs
npx wrangler kv bulk put data/profiles/kv-bulk.json --binding=PROFILES \
  --config api/wrangler.jsonc --local --persist-to .wrangler/state
```
