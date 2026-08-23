import { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import { STANCES } from "@civic-compass/shared";
import {
  answerSelections,
  answers as answersTable,
  articleQuestions,
  createDb,
} from "@civic-compass/db";
import type { AppEnv } from "../bindings";
import { requireCurrentUser } from "../session";
import { buildUserProfile, saveUserProfile } from "../user-profile";

const answers = new Hono<AppEnv>();

answers.use("*", requireCurrentUser);

/** 自由記述の上限。フロントの textarea の maxLength と揃えています。 */
const COMMENT_MAX = 160;

/**
 * `answer_id` は `user_id` と `article_id` から決めています。
 *
 * `unique(user_id, article_id)` があるので1ユーザー1記事1行で、答え直しは
 * 上書きになります。ID を決め打ちにしておくと、既存行を引き直さずに
 * 選択肢の入れ替えができます。
 */
const answerId = (userId: string, articleId: string) => `ans_${userId}_${articleId}`;

const isStance = (value: unknown): value is (typeof STANCES)[number] =>
  typeof value === "string" && (STANCES as readonly string[]).includes(value);

/** いまログインしているユーザーの回答一覧。記事を開き直したときの復元に使います。 */
answers.get("/", async (c) => {
  const currentUserId = c.get("currentUser").userId;
  const db = createDb(c.env.DB);

  const [answerRows, selectionRows] = await Promise.all([
    db.select().from(answersTable).where(eq(answersTable.userId, currentUserId)),
    db
      .select({
        answerId: answerSelections.answerId,
        questionId: answerSelections.questionId,
        stance: answerSelections.stance,
      })
      .from(answerSelections)
      .innerJoin(answersTable, eq(answersTable.answerId, answerSelections.answerId))
      .where(eq(answersTable.userId, currentUserId)),
  ]);

  const selectionsByAnswer = new Map<string, Record<string, string>>();
  for (const row of selectionRows) {
    const selections = selectionsByAnswer.get(row.answerId) ?? {};
    selections[row.questionId] = row.stance;
    selectionsByAnswer.set(row.answerId, selections);
  }

  return c.json({
    answers: answerRows.map((row) => ({
      articleId: row.articleId,
      interest: row.interest,
      comment: row.opinionText ?? "",
      selections: selectionsByAnswer.get(row.answerId) ?? {},
      savedAt: row.updatedAt,
    })),
  });
});

/** 「この記事への意見」の保存。同じ記事に答え直すと上書きします。 */
answers.post("/", async (c) => {
  const currentUserId = c.get("currentUser").userId;
  const body: unknown = await c.req.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return c.json({ status: "error", message: "JSON body is required" }, 400);
  }

  const { articleId, interest, comment, selections } = body as Record<string, unknown>;

  if (typeof articleId !== "string" || articleId.length === 0) {
    return c.json({ status: "error", message: "articleId is required" }, 400);
  }
  if (typeof interest !== "number" || !Number.isFinite(interest) || interest < 0 || interest > 1) {
    return c.json({ status: "error", message: "interest must be a number between 0 and 1" }, 400);
  }
  if (comment !== undefined && (typeof comment !== "string" || comment.length > COMMENT_MAX)) {
    return c.json({ status: "error", message: `comment must be a string of up to ${COMMENT_MAX} characters` }, 400);
  }
  if (typeof selections !== "object" || selections === null || Array.isArray(selections)) {
    return c.json({ status: "error", message: "selections must be an object of questionId to stance" }, 400);
  }

  const db = createDb(c.env.DB);
  const questions = await db
    .select()
    .from(articleQuestions)
    .where(eq(articleQuestions.articleId, articleId))
    .orderBy(asc(articleQuestions.displayOrder));

  if (questions.length === 0) {
    return c.json({ status: "error", message: "Unknown articleId" }, 404);
  }

  // ★セルはクライアントから受け取らず、必ず article_questions から引きます。
  //   frame / target / role を送らせると、任意のセルに投票できてしまいます。
  const chosen = questions.map((question) => {
    const stance = (selections as Record<string, unknown>)[question.id];
    return { question, stance };
  });

  const unanswered = chosen.filter((row) => row.stance === undefined);
  if (unanswered.length > 0) {
    return c.json({
      status: "error",
      message: "All questions must be answered",
      unanswered: unanswered.map((row) => row.question.id),
    }, 400);
  }

  const invalid = chosen.filter((row) => !isStance(row.stance));
  if (invalid.length > 0) {
    return c.json({ status: "error", message: "selections contains an unknown stance" }, 400);
  }

  const knownIds = new Set(questions.map((question) => question.id));
  const strayIds = Object.keys(selections as Record<string, unknown>).filter((id) => !knownIds.has(id));
  if (strayIds.length > 0) {
    return c.json({ status: "error", message: "selections contains a question from another article", strayIds }, 400);
  }

  const id = answerId(currentUserId, articleId);
  const now = new Date().toISOString();

  // 3文を1バッチで流します。選択肢の入れ替え中に読まれると
  // 「回答はあるが選択肢が無い」状態が見えてしまうため。
  await db.batch([
    db.delete(answerSelections).where(eq(answerSelections.answerId, id)),
    db
      .insert(answersTable)
      .values({
        answerId: id,
        userId: currentUserId,
        articleId,
        interest,
        opinionText: comment ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: answersTable.answerId,
        set: { interest, opinionText: comment ?? null, updatedAt: now },
      }),
    db.insert(answerSelections).values(
      chosen.map(({ question, stance }) => ({
        answerId: id,
        questionId: question.id,
        stance: stance as (typeof STANCES)[number],
        // 回答時点のセルを固定します。設問を直しても過去の回答の意味が変わらないように。
        frame: question.frame,
        target: question.target,
        role: question.role,
        intensity: question.intensity,
        confidence: question.confidence,
      })),
    ),
  ]);

  // 回答が変わればプロファイルも変わるので、ここで作り直して KV に置きます。
  // C（マッチ度API）はリクエストのたびに集計せず、これを読むだけにします。
  //
  // 失敗しても保存自体は成功させます。プロファイルは D1 から何度でも作り直せる
  // 派生データで、ここで 500 を返すと「保存できていないのか」が利用者に分からなく
  // なるためです。
  try {
    await saveUserProfile(c.env.USER_PROFILES, await buildUserProfile(db, currentUserId, now));
  } catch (error) {
    console.error(JSON.stringify({
      message: "Failed to update user profile",
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  return c.json({
    answer: {
      articleId,
      interest,
      comment: typeof comment === "string" ? comment : "",
      selections: Object.fromEntries(chosen.map(({ question, stance }) => [question.id, stance])),
      savedAt: now,
    },
  });
});

export default answers;
