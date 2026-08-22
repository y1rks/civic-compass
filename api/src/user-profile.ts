import { eq } from "drizzle-orm";
import { aggregateUserProfile, userProfileKey, type UserProfile } from "@civic-compass/shared";
import { answerSelections, answers as answersTable, type Db } from "@civic-compass/db";

export { USER_PROFILE_VERSION, userProfileKey, type UserProfile } from "@civic-compass/shared";

/** D1 の回答からユーザープロファイルを作ります。集計そのものは shared 側にあります。 */
export async function buildUserProfile(db: Db, userId: string, now: string): Promise<UserProfile> {
  const rows = await db
    .select({
      interest: answersTable.interest,
      answerId: answerSelections.answerId,
      stance: answerSelections.stance,
      frame: answerSelections.frame,
      target: answerSelections.target,
      role: answerSelections.role,
      intensity: answerSelections.intensity,
      confidence: answerSelections.confidence,
    })
    .from(answerSelections)
    .innerJoin(answersTable, eq(answersTable.answerId, answerSelections.answerId))
    .where(eq(answersTable.userId, userId));

  return aggregateUserProfile(rows, userId, now);
}

/** 意見の保存後に呼びます。議員側とは別の名前空間に置きます。 */
export async function saveUserProfile(kv: KVNamespace, profile: UserProfile): Promise<void> {
  await kv.put(userProfileKey(profile.user_id), JSON.stringify(profile));
}
