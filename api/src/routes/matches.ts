import { Hono } from "hono";
import { userProfileKey, type UserProfile } from "@civic-compass/shared";
import type { AppEnv } from "../bindings";
import { requireCurrentUser } from "../session";
import { politicianMatches } from "../data/politicians";
import politiciansMaster from "../../../scripts/kokkai/politicians.json";
import partiesMaster from "../../../scripts/kokkai/parties.json";
import {
  MIN_ANSWERS,
  calculateProfileMatch,
  isPartyProfile,
  isPoliticianProfile,
  isUserProfile,
  makeUserSummary,
  parseCellKey,
  type CellKey,
  type PartyProfile,
  type PoliticianProfile,
} from "../profile-match";

const matches = new Hono<AppEnv>();

const DISCLAIMER = "これは参考情報であり、特定の候補者や政党への投票を推奨するものではありません。";

/**
 * 画面に並べる数。議員・政党とも同じ7件にします。
 *
 * 対象議員15人・議席を持つ政党13党に対して7件なので、どちらも「近い側の半分」までが
 * 見えます。片方だけ件数が違うと、タブを切り替えたときに母数が変わったように見えます。
 */
const MAX_MATCHES = 7;

const INSUFFICIENT_SUMMARY = "もう少しニュースへの考えを保存すると、考えが近い政治家を分析できます。";

type PoliticianMaster = {
  speaker_id: string;
  name: string;
  party: string;
  house: string;
  website: string;
  active?: boolean;
};

/**
 * 政党マスタ。**国会に議席を持つ政党すべて**を持ちます。
 *
 * 議員マスタから所属党を数え上げると、プロファイルを作った15人が属する党しか出てきません。
 * 政党マッチは公約から作ったプロファイルで全党を横並びに比べるので、党の一覧はここが正です。
 */
type PartyMaster = {
  party_id: string;
  name: string;
  short_name: string;
  seats: { shugiin: number; sangiin: number };
  website: string;
  /** 政党色（Wikipedia Template:政党色）。アイコンの塗りにだけ使います。 */
  color: string;
  active?: boolean;
};

const activePoliticians = (politiciansMaster.politicians as PoliticianMaster[])
  .filter((politician) => politician.active !== false);

const activeParties = (partiesMaster.parties as PartyMaster[])
  .filter((party) => party.active !== false);

async function listCellUniverse(namespace: KVNamespace): Promise<Set<CellKey>> {
  const universe = new Set<CellKey>();
  let cursor: string | undefined;

  do {
    const page = await namespace.list({ prefix: "cellidx:", cursor });
    for (const { name } of page.keys) {
      const key = parseCellKey(name.slice("cellidx:".length));
      if (key) universe.add(key);
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  } while (cursor);

  return universe;
}

const unreliableResponse = (userId: string, summary = INSUFFICIENT_SUMMARY) => ({
  user_id: userId,
  reliable: false,
  user_summary: summary,
  matches: [],
  party_matches: [],
  disclaimer: DISCLAIMER,
});

/** 政治コンパス画面に表示する、現在のユーザーの総合マッチです。 */
matches.get("/profile", requireCurrentUser, async (c) => {
  const currentUserId = c.get("currentUser").userId;
  try {
    const rawUser = await c.env.USER_PROFILES.get<unknown>(userProfileKey(currentUserId), "json");

    if (rawUser === null) return c.json(unreliableResponse(currentUserId));
    if (!isUserProfile(rawUser) || rawUser.user_id !== currentUserId) {
      return c.json({ status: "error", message: "ユーザープロファイルの形式が不正です。" }, 500);
    }

    const user: UserProfile = rawUser;
    if (user.cells.length === 0 || user.n_answers < MIN_ANSWERS) {
      return c.json(unreliableResponse(user.user_id));
    }

    const [universe, rawProfiles] = await Promise.all([
      listCellUniverse(c.env.PROFILES),
      Promise.all(
        activePoliticians.map((politician) => c.env.PROFILES.get<unknown>(`profile:${politician.speaker_id}`, "json")),
      ),
    ]);
    const candidates: { master: PoliticianMaster; profile: PoliticianProfile }[] = [];
    for (const [index, rawProfile] of rawProfiles.entries()) {
      if (rawProfile === null) continue;
      if (!isPoliticianProfile(rawProfile) || rawProfile.speaker_id !== activePoliticians[index].speaker_id) {
        return c.json({ status: "error", message: "議員プロファイルの形式が不正です。" }, 500);
      }
      candidates.push({ master: activePoliticians[index], profile: rawProfile });
    }

    const ranked = candidates
      .flatMap(({ master, profile }) => {
        const result = calculateProfileMatch(user, profile, universe);
        return result.reliable ? [{ master, profile, result }] : [];
      })
      .sort((a, b) =>
        b.result.match_score - a.result.match_score
        || b.result.matched_cells - a.result.matched_cells
        || a.profile.speaker_id.localeCompare(b.profile.speaker_id))
      .slice(0, MAX_MATCHES);

    if (ranked.length === 0) {
      return c.json(unreliableResponse(user.user_id, makeUserSummary(user)));
    }

    // 候補議員の所属党ではなく、議席を持つ全政党を対象にします。
    // 対象議員のいない党（公約だけでプロファイルを作った党）も並べるためです。
    const rawPartyProfiles = await Promise.all(
      activeParties.map((party) => c.env.PROFILES.get<unknown>(`profile:party:${party.name}`, "json")),
    );
    const partyEntries: { master: PartyMaster; profile: PartyProfile }[] = [];
    for (const [index, rawProfile] of rawPartyProfiles.entries()) {
      if (rawProfile === null) continue;
      if (!isPartyProfile(rawProfile) || rawProfile.party !== activeParties[index].name) {
        return c.json({ status: "error", message: "政党プロファイルの形式が不正です。" }, 500);
      }
      partyEntries.push({ master: activeParties[index], profile: rawProfile });
    }

    // ★ここで `profile:evidence:{id}` は読みません。政治コンパス画面は発言の原文を
    //   出さないためです。読むと議員1人あたり約1.1MB（profile 本体の100倍以上）を
    //   無駄に展開することになります。
    //   根拠の原文が要る画面は B（`GET /api/perspectives/:articleId`）が別に読みます。
    const politicianResults = ranked.map(({ master, profile, result }) => ({
      speaker_id: profile.speaker_id,
      politician_name: profile.politician_name,
      party: profile.party,
      house: profile.house,
      website: master.website,
      // バッチが cells から作った傾向の要約。カードに出します。
      summary: profile.summary ?? "",
      match_score: result.match_score,
      matched_cells: result.matched_cells,
      reasons: result.reasons,
      differences: result.differences,
    }));

    const partyResults = partyEntries
      .flatMap(({ master, profile }) => {
        const result = calculateProfileMatch(user, profile, universe);
        return result.reliable ? [{ master, profile, result }] : [];
      })
      .map(({ master, profile, result }) => ({
        party_id: master.party_id,
        party: profile.party,
        short_name: master.short_name,
        website: master.website,
        seats: master.seats,
        color: master.color,
        summary: profile.summary ?? "",
        // manifesto（公約のみ）/ members（所属議員のみ）/ mixed。画面で出典を断るために返します。
        source: profile.source ?? "members",
        match_score: result.match_score,
        matched_cells: result.matched_cells,
        n_politicians: profile.n_politicians,
        reasons: result.reasons,
        differences: result.differences,
      }))
      .sort((a, b) => b.match_score - a.match_score || a.party.localeCompare(b.party, "ja"))
      .slice(0, MAX_MATCHES);

    return c.json({
      user_id: user.user_id,
      reliable: true,
      user_summary: makeUserSummary(user),
      matches: politicianResults,
      party_matches: partyResults,
      disclaimer: DISCLAIMER,
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "総合マッチの生成に失敗しました。",
      error: error instanceof Error ? error.message : String(error),
    }));
    return c.json({ status: "error", message: "総合マッチを取得できませんでした。" }, 500);
  }
});

// 記事保存直後の「今回のマッチ」は別機能として、現時点ではデモ値を維持します。
matches.get("/:articleId", (c) => {
  const articleId = c.req.param("articleId");
  if (articleId.length === 0) {
    return c.json({ status: "error", message: "articleId is required" }, 400);
  }

  return c.json({ matches: politicianMatches });
});

// 旧クライアントが誤って古い契約を使い続けないよう、移行先を明示します。
matches.post("/profile", (c) => c.json({
  status: "error",
  message: "総合マッチAPIは GET /api/matches/profile を使用してください。",
}, 405));

export default matches;
