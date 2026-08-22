import { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import {
  articleQuestionOptions,
  articleQuestions,
  articles as articlesTable,
  createDb,
} from "@civic-compass/db";
import type { AppEnv } from "../bindings";

const articles = new Hono<AppEnv>();

/**
 * 記事に紐づく争点。1設問 = frame × target × role のセル1つで、
 * 選択肢は uphold / override / neutral の3つ（単一選択）。
 *
 * 画面には `label` だけを出し、`stance` は文面が担います。
 * 賛成／反対ボタンとして出してはいけません（docs/design-constraints.md）。
 */
type QuestionResponse = {
  id: string;
  prompt: string;
  frame: string;
  target: string;
  role: string;
  options: { id: string; stance: string; label: string }[];
};

articles.get("/", async (c) => {
  const db = createDb(c.env.DB);

  const [articleRows, optionRows] = await Promise.all([
    db.select().from(articlesTable).orderBy(asc(articlesTable.displayOrder)),
    db
      .select({
        questionId: articleQuestions.id,
        articleId: articleQuestions.articleId,
        questionOrder: articleQuestions.displayOrder,
        prompt: articleQuestions.prompt,
        frame: articleQuestions.frame,
        target: articleQuestions.target,
        role: articleQuestions.role,
        optionId: articleQuestionOptions.id,
        optionOrder: articleQuestionOptions.displayOrder,
        stance: articleQuestionOptions.stance,
        label: articleQuestionOptions.labelText,
      })
      .from(articleQuestions)
      .innerJoin(articleQuestionOptions, eq(articleQuestionOptions.questionId, articleQuestions.id))
      .orderBy(
        asc(articleQuestions.articleId),
        asc(articleQuestions.displayOrder),
        asc(articleQuestionOptions.displayOrder),
      ),
  ]);

  // 設問と選択肢を1クエリで引いているので、記事ごと・設問ごとに畳み直します。
  const questionsByArticle = new Map<string, QuestionResponse[]>();
  const questionById = new Map<string, QuestionResponse>();

  for (const row of optionRows) {
    let question = questionById.get(row.questionId);
    if (!question) {
      question = {
        id: row.questionId,
        prompt: row.prompt,
        frame: row.frame,
        target: row.target,
        role: row.role,
        options: [],
      };
      questionById.set(row.questionId, question);

      const list = questionsByArticle.get(row.articleId);
      if (list) list.push(question);
      else questionsByArticle.set(row.articleId, [question]);
    }
    question.options.push({ id: row.optionId, stance: row.stance, label: row.label });
  }

  return c.json({
    articles: articleRows.map(({ displayOrder: _, body, ...article }) => ({
      ...article,
      body: JSON.parse(body) as string[],
      questions: questionsByArticle.get(article.id) ?? [],
    })),
  });
});

export default articles;
