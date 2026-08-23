-- neutral の選択肢の文面を統一する（スキーマ変更なし・データのみ）。
--
--   「特に気にならない」→「どちらでもない／どちらでも良い」
--
-- neutral は「その論点に関心がない」ではなく「どちらの言い分とも決めかねる」を
-- 拾うための選択肢です。前の文面は関心の有無を尋ねているように読めました。
-- 集計上の扱い（cells には入れず declined_cells に回す）は変わりません。
UPDATE `article_question_options`
  SET `label_text` = 'どちらでもない／どちらでも良い'
  WHERE `stance` = 'neutral';
