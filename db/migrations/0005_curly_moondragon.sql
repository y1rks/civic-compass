-- 設問カタログの穴を埋めるための記事3本（スキーマ変更なし・データのみ）。
--
-- 追加前は15問が15セルしか触れておらず、`sovereignty` と `evidence_expertise` の
-- 設問が1問もありませんでした。自己再現テスト（議員本人が設問に答えたら本人が
-- 1位に返るか）で、主軸が sovereignty の神谷宗幣は13位、
-- care_harm × 障害者・マイノリティ が主軸の天畠大輔は10位と、
-- **本人ですら再現できない**状態でした。
--
-- 語彙は shared/src/vocabulary.ts が正、設計上の約束は
-- docs/design-constraints.md「ユーザー側の入力（記事の設問）」。
-- 1設問 = frame × target × role のセル1つ、選択肢は uphold / override / neutral の3行。
INSERT INTO `articles` (`id`, `display_order`, `category`, `title`, `summary`, `body`, `image`, `source`, `published_at`) VALUES
  ('econ-security', 9, '経済・産業', '経済安全保障の新方針、重要物資の国内生産を支援へ', '半導体や医薬品原料などを対象に、国内での生産体制を支える新たな支援策がまとまりました。財源と支援先の選び方が論点です。', '["政府は21日、経済安全保障に関する新たな方針を示しました。半導体、蓄電池、医薬品の原料など、供給が止まると生活や産業に影響が及ぶ品目を「重要物資」に指定し、国内で生産する企業へ設備投資の一部を補助します。","背景には、海外の一部地域に生産が集中している現状があります。方針では、調達先を分散させることに加え、国内でも一定量を作れる体制を保つことを目標に掲げました。対象品目は今後、専門家会議が随時見直します。","支援の規模は5年間で数兆円とされ、財源の裏づけが課題です。また、応募できるのは大規模な設備投資が可能な企業が中心となる見通しで、支援先の偏りを懸念する声も出ています。"]', 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=85', 'civic-compass NEWS', '3時間前'),
  ('foreign-workers', 10, '暮らし・地域', '外国人労働者の受け入れ拡大、自治体で支援体制に差', '受け入れ人数の上限を引き上げる制度改正を受け、生活相談や日本語教育の体制づくりが自治体ごとに分かれています。', '["人手不足が続く分野で外国人労働者の受け入れ枠を広げる制度改正が、来年度から順次実施されます。対象は介護、建設、農業など14分野で、在留期間の上限も見直されました。","受け入れが先行する自治体では、多言語の生活相談窓口や日本語教室を整えた例がある一方、専任の担当者を置けていない自治体もあります。転居や転職で人の動きがあるため、地域ごとの体制の差が生活面の課題として表れています。","受け入れ人数の決め方についても議論があります。現在は分野ごとに国が上限を定めていますが、地域の実情に応じて自治体が関与できる仕組みを求める声と、全国で統一した基準を保つべきだとの意見が出ています。"]', 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=85', 'みらい通信', '5時間前'),
  ('home-care', 11, '医療・福祉', '難病患者の在宅医療、支援制度の対象範囲を見直しへ', '在宅で医療的ケアを受ける人への支援制度について、対象範囲と担い手の負担が議論されています。', '["重い障害や難病があり、在宅で医療的なケアを受けながら暮らす人への支援制度の見直しが始まりました。訪問看護の回数や、生活を支える介助者の派遣時間をどこまで公費で賄うかが焦点です。","制度の対象は、病名や障害の程度に応じた基準で決まっています。この基準について、診断名では区切れない状態の人が支援から外れているとの指摘があり、厚生労働省の検討会は医学的なデータをもとに範囲を見直す方針を示しました。一方で、対象を広げれば費用が増えるため、優先順位の付け方が課題になります。","家族が介助を担う場合の負担も論点です。国の調査では、主に介助を担う人の約7割が女性で、仕事を辞めたり時間を減らしたりした人が一定数いることが示されています。"]', 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=900&q=85', 'LOCAL POLICY', '7時間前');
--> statement-breakpoint
-- ★この3本で初めて触れるセル
--   sovereignty × 国民全体          … 神谷宗幣2.3倍 / 榛葉賀津也2.2倍 / 高市早苗1.6倍
--   evidence_expertise × 国民全体   … 安野貴博1.9倍 / 河野太郎1.5倍
--   care_harm × 障害者・マイノリティ  … 天畠大輔5.7倍
--   care_harm × 女性                … 稲田朋美1.9倍 / 田村智子1.5倍
--   fairness × 大企業・産業 × threat … 田村智子2.6倍
--   care_harm / loyalty_community × 外国人・移民（role が逆向きの対）
INSERT INTO `article_questions` (`id`, `article_id`, `display_order`, `prompt`, `frame`, `target`, `role`, `intensity`, `confidence`) VALUES
  ('econ-security_q1', 'econ-security', 1, '重要物資を海外に頼ることについて', 'sovereignty', '国民全体', 'beneficiary', 0.7, 0.9),
  ('econ-security_q2', 'econ-security', 2, '支援に充てる財源について', 'efficiency_utility', '国民全体', 'beneficiary', 0.7, 0.9),
  ('econ-security_q3', 'econ-security', 3, '支援先が大企業に偏ることについて', 'fairness', '大企業・産業', 'threat', 0.7, 0.9),
  ('foreign-workers_q1', 'foreign-workers', 1, '受け入れが進む地域での生活支援について', 'care_harm', '外国人・移民', 'beneficiary', 0.7, 0.9),
  ('foreign-workers_q2', 'foreign-workers', 2, '受け入れ拡大が地域社会に与える影響について', 'loyalty_community', '外国人・移民', 'threat', 0.7, 0.9),
  ('foreign-workers_q3', 'foreign-workers', 3, '受け入れ人数の決め方について', 'procedure_rule_of_law', '国民全体', 'beneficiary', 0.7, 0.9),
  ('home-care_q1', 'home-care', 1, '重い障害のある人の在宅での暮らしについて', 'care_harm', '障害者・マイノリティ', 'beneficiary', 0.7, 0.9),
  ('home-care_q2', 'home-care', 2, '支援の対象範囲の決め方について', 'evidence_expertise', '国民全体', 'beneficiary', 0.7, 0.9),
  ('home-care_q3', 'home-care', 3, '介助の担い手が女性に偏っていることについて', 'care_harm', '女性', 'beneficiary', 0.7, 0.9);
--> statement-breakpoint
-- stance は UI コントロールにせず label_text の文面が担う（賛否と誤解されるため）。
INSERT INTO `article_question_options` (`id`, `question_id`, `display_order`, `stance`, `label_text`) VALUES
  ('econ-security_q1_uphold', 'econ-security_q1', 1, 'uphold', '生活に欠かせないものは、自国で作れる状態を保つべきだ'),
  ('econ-security_q1_override', 'econ-security_q1', 2, 'override', '他国と分担したほうが安く手に入る。自前にこだわると立ち行かない'),
  ('econ-security_q1_neutral', 'econ-security_q1', 3, 'neutral', '特に気にならない'),
  ('econ-security_q2_uphold', 'econ-security_q2', 1, 'uphold', '費用に見合う効果があるかで判断すべきだ'),
  ('econ-security_q2_override', 'econ-security_q2', 2, 'override', '採算では測れない。必要な備えには費用をかけるべきだ'),
  ('econ-security_q2_neutral', 'econ-security_q2', 3, 'neutral', '特に気にならない'),
  ('econ-security_q3_uphold', 'econ-security_q3', 1, 'uphold', '体力のある企業に支援が集まるのは、負担と分配が釣り合っていない'),
  ('econ-security_q3_override', 'econ-security_q3', 2, 'override', '規模のある企業が担うほうが確実で、多少の偏りはやむを得ない'),
  ('econ-security_q3_neutral', 'econ-security_q3', 3, 'neutral', '特に気にならない'),
  ('foreign-workers_q1_uphold', 'foreign-workers_q1', 1, 'uphold', '言葉や制度が分からず困る人が出ないよう、支援を整えるべきだ'),
  ('foreign-workers_q1_override', 'foreign-workers_q1', 2, 'override', '支援は必要だが、まずは受け入れる側の負担を考えるべきだ'),
  ('foreign-workers_q1_neutral', 'foreign-workers_q1', 3, 'neutral', '特に気にならない'),
  ('foreign-workers_q2_uphold', 'foreign-workers_q2', 1, 'uphold', '急な受け入れで地域のつながりが保てなくなることを心配している'),
  ('foreign-workers_q2_override', 'foreign-workers_q2', 2, 'override', '地域は変わっていくもので、それを理由に受け入れを狭めるべきではない'),
  ('foreign-workers_q2_neutral', 'foreign-workers_q2', 3, 'neutral', '特に気にならない'),
  ('foreign-workers_q3_uphold', 'foreign-workers_q3', 1, 'uphold', '誰がどう決めるかの手順を、まず定めるべきだ'),
  ('foreign-workers_q3_override', 'foreign-workers_q3', 2, 'override', '手続きの議論より、現場で足りていない人手にすぐ応えるべきだ'),
  ('foreign-workers_q3_neutral', 'foreign-workers_q3', 3, 'neutral', '特に気にならない'),
  ('home-care_q1_uphold', 'home-care_q1', 1, 'uphold', '暮らしが立ち行かなくなる人が出ないよう、支援を厚くすべきだ'),
  ('home-care_q1_override', 'home-care_q1', 2, 'override', '支援は要るが、制度全体で支えられる範囲に収めるべきだ'),
  ('home-care_q1_neutral', 'home-care_q1', 3, 'neutral', '特に気にならない'),
  ('home-care_q2_uphold', 'home-care_q2', 1, 'uphold', '医学的なデータや専門家の評価にもとづいて決めるべきだ'),
  ('home-care_q2_override', 'home-care_q2', 2, 'override', '数字に表れない事情があるので、専門家の判断だけに委ねるべきではない'),
  ('home-care_q2_neutral', 'home-care_q2', 3, 'neutral', '特に気にならない'),
  ('home-care_q3_uphold', 'home-care_q3', 1, 'uphold', '特定の立場の人に負担が寄っている状態は改めるべきだ'),
  ('home-care_q3_override', 'home-care_q3', 2, 'override', '誰が担うかは各家庭の事情で、制度が立ち入ることではない'),
  ('home-care_q3_neutral', 'home-care_q3', 3, 'neutral', '特に気にならない');
