-- 設問を「向きが割れる論点」に組み替える（スキーマ変更なし・データのみ）。
--
-- 現行24問のうち **22問は override が1人も出ません**（全員が uphold）。そのため
-- 思想が対極の議員が同じ回答になり、マッチ度で分離できませんでした。
--   神谷宗幣 vs 天畠大輔  両者が答えた19問のうち、向きが違うのは 0問
--   高市早苗 vs 田村智子  同じく 0問
--
-- 議員間で score が割れているセル（標準偏差 0.35以上・保有5人以上は24種ある）に
-- 差し替え・追加します。自己再現テストで 1位的中 12/15 → 15/15、
-- 対極ペアの平均 71.3% → 54.8%。
--
-- ★選択肢の文面は **frame の向きと target・role の両方が読み取れる**ように書くこと。
--   「費用対効果で判断すべきだ」だけでは efficiency_utility × 国民全体 と区別がつきません。
--   各設問の向きは data/utterances.jsonl の実際の発言で裏を取っています（コメント参照）。
--
-- 記事本文は変更しません。設問と選択肢だけの差し替えです。
-- 既存の回答（answer_selections）は回答時点の frame / target / role を複製して
-- 持っているので、ここでの変更は過去の回答に遡及しません。

-- ============ 差し替え 8問 ============

-- efficiency_utility × 自然環境。uphold=高市「経済成長、脱炭素の同時実現」
-- override=小泉「最優先は脱炭素と環境だ」／田村「パネルの設置に邪魔だから樹木を切って」
UPDATE `article_questions` SET `prompt` = '環境への影響を抑える費用について',
  `frame` = 'efficiency_utility', `target` = '自然環境', `role` = 'beneficiary'
  WHERE `id` = 'energy-2035_q2';
UPDATE `article_question_options` SET `label_text` = '費用に見合う効果があるなら、環境を守る対策を進めるべきだ' WHERE `id` = 'energy-2035_q2_uphold';
UPDATE `article_question_options` SET `label_text` = '費用に関わらず、環境への影響は避けるべきだ' WHERE `id` = 'energy-2035_q2_override';

-- authority_order × 子ども・将来世代。uphold=高市「熱中症対策の義務づけ」
-- override=小川「部活動の制限、練習試合をするな」／藤田「努力義務による社会的インセンティブ」
UPDATE `article_questions` SET `prompt` = '学校ごとの運用の違いについて',
  `frame` = 'authority_order', `target` = '子ども・将来世代', `role` = 'beneficiary'
  WHERE `id` = 'childcare_q2';
UPDATE `article_question_options` SET `label_text` = '子どもを守るため、国が基準を定めて守らせるべきだ' WHERE `id` = 'childcare_q2_uphold';
UPDATE `article_question_options` SET `label_text` = '一律の決まりで縛るより、現場の判断に委ねるべきだ' WHERE `id` = 'childcare_q2_override';

-- authority_order × 中小企業。uphold=河野「中小企業に至るまでサイバー防御を」
-- override=河野「規制でがちがちのタクシー規制を改革」
UPDATE `article_questions` SET `prompt` = '地域の小さな事業者への対応について',
  `frame` = 'authority_order', `target` = '中小企業', `role` = 'beneficiary'
  WHERE `id` = 'mobility_q2';
UPDATE `article_question_options` SET `label_text` = '国が体制を整えて、小さな事業者を守るべきだ' WHERE `id` = 'mobility_q2_uphold';
UPDATE `article_question_options` SET `label_text` = '規制を増やすより、現場の裁量に任せるべきだ' WHERE `id` = 'mobility_q2_override';

-- liberty_autonomy × 現役世代。override=小川「自助に現役世代の生活を置いておくことはできない」
UPDATE `article_questions` SET `prompt` = '働く時間の決め方について',
  `frame` = 'liberty_autonomy', `target` = '現役世代', `role` = 'beneficiary'
  WHERE `id` = 'workweek_q1';
UPDATE `article_question_options` SET `label_text` = '働く世代が自分で選べるようにすべきだ' WHERE `id` = 'workweek_q1_uphold';
UPDATE `article_question_options` SET `label_text` = '選択に委ねると、立場の弱い人が損をする' WHERE `id` = 'workweek_q1_override';

-- authority_order × 個人。★13人中8人が override する最も弁別力の高いセル。
-- uphold=高市「本人確認の仕組みをしっかり機能させる」
-- override=稲田「検察、警察の不正、不当な活動」／小泉「地理試験という紙の試験で」
UPDATE `article_questions` SET `prompt` = '本人確認を厳格にすることについて',
  `frame` = 'authority_order', `target` = '個人', `role` = 'beneficiary'
  WHERE `id` = 'digital_q2';
UPDATE `article_question_options` SET `label_text` = 'なりすましを防ぐため、本人確認は厳しくすべきだ' WHERE `id` = 'digital_q2_uphold';
UPDATE `article_question_options` SET `label_text` = '管理を強めるより、使いやすさを損なわないことを優先すべきだ' WHERE `id` = 'digital_q2_override';

-- efficiency_utility × 高齢者。override=小川「公定価格の矛盾。費用を反映していない」
UPDATE `article_questions` SET `prompt` = '介護給付の伸びを抑えることについて',
  `frame` = 'efficiency_utility', `target` = '高齢者', `role` = 'beneficiary'
  WHERE `id` = 'care_q1';
UPDATE `article_question_options` SET `label_text` = '高齢者への支援は、費用に見合う効果があるかで見直すべきだ' WHERE `id` = 'care_q1_uphold';
UPDATE `article_question_options` SET `label_text` = '費用の計算より、必要な支援が届くことが先だ' WHERE `id` = 'care_q1_override';

-- efficiency_utility × 現役世代。override=藤田「企業に負担を負わすと雇用に影響が出る」
UPDATE `article_questions` SET `prompt` = '保険料を負担する現役世代について',
  `frame` = 'efficiency_utility', `target` = '現役世代', `role` = 'beneficiary'
  WHERE `id` = 'care_q2';
UPDATE `article_question_options` SET `label_text` = '働く世代の負担と効果が見合うかで判断すべきだ' WHERE `id` = 'care_q2_uphold';
UPDATE `article_question_options` SET `label_text` = '採算の話より、働く人の暮らしが成り立つことが先だ' WHERE `id` = 'care_q2_override';

-- authority_order × 大企業・産業。uphold=高市「事業者の予見可能性を高める大胆な措置」
-- override=小泉「八日間やることが目的化していて」
UPDATE `article_questions` SET `prompt` = '支援を受けた企業への国の関わり方について',
  `frame` = 'authority_order', `target` = '大企業・産業', `role` = 'beneficiary'
  WHERE `id` = 'econ-security_q3';
UPDATE `article_question_options` SET `label_text` = '国が枠組みを示し、企業が見通しを持てるようにすべきだ' WHERE `id` = 'econ-security_q3_uphold';
UPDATE `article_question_options` SET `label_text` = '決まりを増やすほど、かえって企業の動きが鈍る' WHERE `id` = 'econ-security_q3_override';
--> statement-breakpoint
-- ============ 新設 9問 ============
--
-- ★ sovereignty × 国際社会 の向きに注意。「国際的な枠組みに合わせる」は uphold ではなく
--   **override**（主権・自立を優先順位の下に置いた）。実際の発言でも
--   uphold=高市「域内の各国が自律性と強靱性を身につけて」
--   override=高市「サイバー攻撃への対応、国際的な連携が絶対に重要」となっている。
INSERT INTO `article_questions` (`id`, `article_id`, `display_order`, `prompt`, `frame`, `target`, `role`, `intensity`, `confidence`) VALUES
  ('energy-2035_q3', 'energy-2035', 3, '国際的な削減目標との関わり方について', 'sovereignty', '国際社会', 'beneficiary', 0.7, 0.9),
  ('mobility_q3', 'mobility', 3, '配車を担う大手事業者について', 'authority_order', '大企業・産業', 'threat', 0.7, 0.9),
  ('disaster_q3', 'disaster', 3, '被害想定の見直しについて', 'evidence_expertise', '地方', 'beneficiary', 0.7, 0.9),
  ('digital_q3', 'digital', 3, '制度を悪用する利用者への対応について', 'authority_order', '個人', 'threat', 0.7, 0.9),
  ('digital_q4', 'digital', 4, '利用状況のデータを制度の改善に使うことについて', 'evidence_expertise', '個人', 'beneficiary', 0.7, 0.9),
  ('housing_q3', 'housing', 3, '自治体が空き家対策に費やす費用について', 'efficiency_utility', '地方', 'beneficiary', 0.7, 0.9),
  ('econ-security_q4', 'econ-security', 4, '他国からの働きかけについて', 'authority_order', '国際社会', 'threat', 0.7, 0.9),
  ('econ-security_q5', 'econ-security', 5, '支援先の選び方について', 'procedure_rule_of_law', '大企業・産業', 'beneficiary', 0.7, 0.9),
  ('foreign-workers_q4', 'foreign-workers', 4, '受け入れ企業の負担について', 'efficiency_utility', '中小企業', 'beneficiary', 0.7, 0.9);
--> statement-breakpoint
INSERT INTO `article_question_options` (`id`, `question_id`, `display_order`, `stance`, `label_text`) VALUES
  ('energy-2035_q3_uphold', 'energy-2035_q3', 1, 'uphold', '各国が自分で決められることを大事にしながら進めるべきだ'),
  ('energy-2035_q3_override', 'energy-2035_q3', 2, 'override', '一国だけでは対応できない。国際的な枠組みに合わせるべきだ'),
  ('energy-2035_q3_neutral', 'energy-2035_q3', 3, 'neutral', '特に気にならない'),
  ('mobility_q3_uphold', 'mobility_q3', 1, 'uphold', '不正や独占を許さないよう、大手への監督を強めるべきだ'),
  ('mobility_q3_override', 'mobility_q3', 2, 'override', '規制で縛るより、競争や情報公開で正すべきだ'),
  ('mobility_q3_neutral', 'mobility_q3', 3, 'neutral', '特に気にならない'),
  ('disaster_q3_uphold', 'disaster_q3', 1, 'uphold', '専門家の分析やデータにもとづいて、地域の対策を決めるべきだ'),
  ('disaster_q3_override', 'disaster_q3', 2, 'override', 'データより、地域で暮らす人が実際に感じていることを重く見るべきだ'),
  ('disaster_q3_neutral', 'disaster_q3', 3, 'neutral', '特に気にならない'),
  ('digital_q3_uphold', 'digital_q3', 1, 'uphold', '悪用する人がいる以上、取り締まりを強めるべきだ'),
  ('digital_q3_override', 'digital_q3', 2, 'override', '一部の行いを理由に、全体を縛るべきではない'),
  ('digital_q3_neutral', 'digital_q3', 3, 'neutral', '特に気にならない'),
  ('digital_q4_uphold', 'digital_q4', 1, 'uphold', '一人ひとりの状況をデータで把握して、制度を改善すべきだ'),
  ('digital_q4_override', 'digital_q4', 2, 'override', '数字に表れない個々の事情があるので、データだけで決めるべきでない'),
  ('digital_q4_neutral', 'digital_q4', 3, 'neutral', '特に気にならない'),
  ('housing_q3_uphold', 'housing_q3', 1, 'uphold', '費用に見合う効果があるかで、地域への対策を判断すべきだ'),
  ('housing_q3_override', 'housing_q3', 2, 'override', '採算では測れない。住民が住み続けられることが先だ'),
  ('housing_q3_neutral', 'housing_q3', 3, 'neutral', '特に気にならない'),
  ('econ-security_q4_uphold', 'econ-security_q4', 1, 'uphold', '他国の影響が及ぶ状態には、規制や備えで対応すべきだ'),
  ('econ-security_q4_override', 'econ-security_q4', 2, 'override', '力で押さえ込む発想より、対話や協調で向き合うべきだ'),
  ('econ-security_q4_neutral', 'econ-security_q4', 3, 'neutral', '特に気にならない'),
  ('econ-security_q5_uphold', 'econ-security_q5', 1, 'uphold', 'あらかじめ定めた手順と基準に沿って、企業を扱うべきだ'),
  ('econ-security_q5_override', 'econ-security_q5', 2, 'override', '手順を厳格にしすぎると、必要な取組が間に合わない'),
  ('econ-security_q5_neutral', 'econ-security_q5', 3, 'neutral', '特に気にならない'),
  ('foreign-workers_q4_uphold', 'foreign-workers_q4', 1, 'uphold', '支援が費用に見合う効果を生むかで判断すべきだ'),
  ('foreign-workers_q4_override', 'foreign-workers_q4', 2, 'override', '採算は望めなくても、地域に必要な事業者は支えるべきだ'),
  ('foreign-workers_q4_neutral', 'foreign-workers_q4', 3, 'neutral', '特に気にならない');
