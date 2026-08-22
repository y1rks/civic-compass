CREATE TABLE `article_question_options` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`display_order` integer NOT NULL,
	`stance` text NOT NULL,
	`label_text` text NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `article_questions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "article_question_options_stance_check" CHECK(stance IN ('uphold', 'override', 'neutral'))
);
--> statement-breakpoint
CREATE INDEX `article_question_options_question_idx` ON `article_question_options` (`question_id`);--> statement-breakpoint
CREATE TABLE `article_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`display_order` integer NOT NULL,
	`prompt` text NOT NULL,
	`frame` text NOT NULL,
	`target` text NOT NULL,
	`role` text NOT NULL,
	`intensity` real DEFAULT 0.7 NOT NULL,
	`confidence` real DEFAULT 0.9 NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "article_questions_frame_check" CHECK(frame IN ('care_harm', 'fairness', 'liberty_autonomy', 'loyalty_community', 'authority_order', 'sanctity_tradition', 'efficiency_utility', 'procedure_rule_of_law', 'sovereignty', 'evidence_expertise')),
	CONSTRAINT "article_questions_target_check" CHECK(target IN ('個人', '家族', '子ども・将来世代', '高齢者', '現役世代', '女性', '障害者・マイノリティ', '中小企業', '大企業・産業', '地方', '国民全体', '外国人・移民', '国際社会', '自然環境')),
	CONSTRAINT "article_questions_role_check" CHECK(role IN ('beneficiary', 'threat'))
);
--> statement-breakpoint
CREATE INDEX `article_questions_article_idx` ON `article_questions` (`article_id`);
--> statement-breakpoint
-- 記事ごとの争点と選択肢。1設問 = frame × target × role のセル1つ。
-- 語彙は shared/src/vocabulary.ts が正（意味は docs/data-reference.md）。
-- 設計上の約束は docs/design-constraints.md「ユーザー側の入力（記事の設問）」。
INSERT INTO `article_questions` (`id`, `article_id`, `display_order`, `prompt`, `frame`, `target`, `role`, `intensity`, `confidence`) VALUES
  ('energy-2035_q1', 'energy-2035', 1, '発電設備が自然環境に与える影響について', 'care_harm', '自然環境', 'beneficiary', 0.7, 0.9),
  ('energy-2035_q2', 'energy-2035', 2, '電気料金への影響について', 'efficiency_utility', '国民全体', 'beneficiary', 0.7, 0.9),
  ('childcare_q1', 'childcare', 1, '家庭の経済状況による差について', 'care_harm', '子ども・将来世代', 'beneficiary', 0.7, 0.9),
  ('childcare_q2', 'childcare', 2, '自治体による差について', 'fairness', '地方', 'beneficiary', 0.7, 0.9),
  ('mobility_q1', 'mobility', 1, '安全の管理について', 'authority_order', '国民全体', 'beneficiary', 0.7, 0.9),
  ('mobility_q2', 'mobility', 2, '既存のタクシー事業との共存について', 'fairness', '中小企業', 'beneficiary', 0.7, 0.9),
  ('workweek_q1', 'workweek', 1, '働き方の決め方について', 'liberty_autonomy', '個人', 'beneficiary', 0.7, 0.9),
  ('disaster_q1', 'disaster', 1, '避難所でのプライバシーについて', 'sanctity_tradition', '国民全体', 'beneficiary', 0.7, 0.9),
  ('disaster_q2', 'disaster', 2, '自治体の財政負担をどう支えるかについて', 'care_harm', '地方', 'beneficiary', 0.7, 0.9),
  ('digital_q1', 'digital', 1, 'デジタル機器の利用に不慣れな人について', 'care_harm', '高齢者', 'beneficiary', 0.7, 0.9),
  ('digital_q2', 'digital', 2, 'デジタル化に伴う情報の扱われ方について', 'procedure_rule_of_law', '個人', 'beneficiary', 0.7, 0.9),
  ('housing_q1', 'housing', 1, '放置された空き家について', 'authority_order', '地方', 'beneficiary', 0.7, 0.9),
  ('housing_q2', 'housing', 2, '若い世帯が移り住むことについて', 'loyalty_community', '地方', 'beneficiary', 0.7, 0.9),
  ('care_q1', 'care', 1, '家族が介護を担うことについて', 'loyalty_community', '家族', 'beneficiary', 0.7, 0.9),
  ('care_q2', 'care', 2, '介護サービスの供給拡大について', 'fairness', '現役世代', 'beneficiary', 0.7, 0.9);
--> statement-breakpoint
-- stance は UI コントロールにせず label_text の文面が担う（同上）。
-- neutral は回答として記録するが cells には入れない。
INSERT INTO `article_question_options` (`id`, `question_id`, `display_order`, `stance`, `label_text`) VALUES
  ('energy-2035_q1_uphold', 'energy-2035_q1', 1, 'uphold', '生態系や景観を壊さないことを優先すべきだ'),
  ('energy-2035_q1_override', 'energy-2035_q1', 2, 'override', '影響はあるだろうが、それを理由に電力供給を低下させるべきではない'),
  ('energy-2035_q1_neutral', 'energy-2035_q1', 3, 'neutral', '特に気にならない'),
  ('energy-2035_q2_uphold', 'energy-2035_q2', 1, 'uphold', '家計への負担を考え、費用対効果で判断すべきだ'),
  ('energy-2035_q2_override', 'energy-2035_q2', 2, 'override', 'コストの問題ではない。多少高くついても切り替えを進めるべきだ'),
  ('energy-2035_q2_neutral', 'energy-2035_q2', 3, 'neutral', '特に気にならない'),
  ('childcare_q1_uphold', 'childcare_q1', 1, 'uphold', '子どもが家庭の事情で食事に差をつけられるべきではない'),
  ('childcare_q1_override', 'childcare_q1', 2, 'override', '気の毒ではあるが、それだけを理由に制度を広げるべきではない'),
  ('childcare_q1_neutral', 'childcare_q1', 3, 'neutral', '特に気にならない'),
  ('childcare_q2_uphold', 'childcare_q2', 1, 'uphold', '先に無償化した自治体とそうでない自治体で差が出るのは不公平だ'),
  ('childcare_q2_override', 'childcare_q2', 2, 'override', '多少の差はやむを得ない。できる自治体から進めればよい'),
  ('childcare_q2_neutral', 'childcare_q2', 3, 'neutral', '特に気にならない'),
  ('mobility_q1_uphold', 'mobility_q1', 1, 'uphold', '管理があいまいなまま広げるのは危険だ'),
  ('mobility_q1_override', 'mobility_q1', 2, 'override', '規制を厳しくしすぎては、地域の移動が成り立たない'),
  ('mobility_q1_neutral', 'mobility_q1', 3, 'neutral', '特に気にならない'),
  ('mobility_q2_uphold', 'mobility_q2', 1, 'uphold', '同じ客を運ぶのに違うルールが適用されるのは、既存の事業者に不公平だ'),
  ('mobility_q2_override', 'mobility_q2', 2, 'override', '事業者間の均衡より、移動できない人をなくすことが先だ'),
  ('mobility_q2_neutral', 'mobility_q2', 3, 'neutral', '特に気にならない'),
  ('workweek_q1_uphold', 'workweek_q1', 1, 'uphold', '働き方は本人が選べるようにすべきだ'),
  ('workweek_q1_override', 'workweek_q1', 2, 'override', '自由といっても、しわ寄せが誰かに行くのでは意味がない'),
  ('workweek_q1_neutral', 'workweek_q1', 3, 'neutral', '特に気にならない'),
  ('disaster_q1_uphold', 'disaster_q1', 1, 'uphold', '避難所でも一人ひとりの尊厳が守られる空間が要る'),
  ('disaster_q1_override', 'disaster_q1', 2, 'override', '非常時であり、そこまで求めるのは難しい'),
  ('disaster_q1_neutral', 'disaster_q1', 3, 'neutral', '特に気にならない'),
  ('disaster_q2_uphold', 'disaster_q2', 1, 'uphold', '財政の弱い自治体が立ち行かなくなる。国が支えるべきだ'),
  ('disaster_q2_override', 'disaster_q2', 2, 'override', '自治体の事情は分かるが、それを理由に基準を緩めるべきではない'),
  ('disaster_q2_neutral', 'disaster_q2', 3, 'neutral', '特に気にならない'),
  ('digital_q1_uphold', 'digital_q1', 1, 'uphold', '機器に不慣れな高齢者が取り残されてはいけない'),
  ('digital_q1_override', 'digital_q1', 2, 'override', '支援は要るが、それを理由に全体を遅らせるべきではない'),
  ('digital_q1_neutral', 'digital_q1', 3, 'neutral', '特に気にならない'),
  ('digital_q2_uphold', 'digital_q2', 1, 'uphold', 'どの情報がどう使われるのか、決め方が不透明だ'),
  ('digital_q2_override', 'digital_q2', 2, 'override', '手続きの議論に時間をかけるより、まず便利にすべきだ'),
  ('digital_q2_neutral', 'digital_q2', 3, 'neutral', '特に気にならない'),
  ('housing_q1_uphold', 'housing_q1', 1, 'uphold', '荒れた空き家が増えれば、地域の安全が損なわれる'),
  ('housing_q1_override', 'housing_q1', 2, 'override', '多少の空き家は、行政が乗り出すほどのことではない'),
  ('housing_q1_neutral', 'housing_q1', 3, 'neutral', '特に気にならない'),
  ('housing_q2_uphold', 'housing_q2', 1, 'uphold', '若い世帯が入って地域のつながりが戻るのはよいことだ'),
  ('housing_q2_override', 'housing_q2', 2, 'override', '地域のつながりより、住む人が困らないことが先だ'),
  ('housing_q2_neutral', 'housing_q2', 3, 'neutral', '特に気にならない'),
  ('care_q1_uphold', 'care_q1', 1, 'uphold', '家族が支え合うことに報いる仕組みがあっていい'),
  ('care_q1_override', 'care_q1', 2, 'override', '家族が担うのが当たり前という前提こそ変えるべきだ'),
  ('care_q1_neutral', 'care_q1', 3, 'neutral', '特に気にならない'),
  ('care_q2_uphold', 'care_q2', 1, 'uphold', '介護の担い手の待遇が低いままでは、サービスは増えない'),
  ('care_q2_override', 'care_q2', 2, 'override', '待遇の話も分かるが、まず必要な量を確保することが先だ'),
  ('care_q2_neutral', 'care_q2', 3, 'neutral', '特に気にならない');
