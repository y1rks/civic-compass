import { Hono } from "hono";
import { userProfileKey, type UserProfile } from "@civic-compass/shared";
import type { AppEnv } from "../bindings";
import { CURRENT_USER_ID } from "../current-user";
import { politicianMatches } from "../data/politicians";
import politiciansMaster from "../../../scripts/kokkai/politicians.json";
import {
  MIN_ANSWERS,
  calculateProfileMatch,
  cellKey,
  isPartyProfile,
  isPoliticianProfile,
  isUserProfile,
  makeUserSummary,
  parseCellKey,
  type CellKey,
  type MatchReason,
  type PartyProfile,
  type PoliticianProfile,
} from "../profile-match";

const matches = new Hono<AppEnv>();

const DISCLAIMER = "これは参考情報であり、特定の候補者や政党への投票を推奨するものではありません。";
const INSUFFICIENT_SUMMARY = "もう少しニュースへの考えを保存すると、考えが近い政治家を分析できます。";

type PoliticianMaster = {
  speaker_id: string;
  name: string;
  party: string;
  house: string;
  website: string;
  active?: boolean;
};

type EvidenceEntry = {
  date?: string | null;
  summary: string;
  url: string;
  quote?: string;
  block_text?: string | null;
  evidence_text?: string;
  evidence_span?: [number, number];
};

type EvidenceProfile = {
  cells: Record<string, EvidenceEntry[]>;
};

type MatchEvidence = {
  date: string | null;
  summary: string;
  url: string;
  frame: MatchReason["frame"];
  target: MatchReason["target"];
  role: MatchReason["role"];
  quote?: string;
  highlight?: string;
};

const activePoliticians = (politiciansMaster.politicians as PoliticianMaster[])
  .filter((politician) => politician.active !== false);

const isEvidenceEntry = (value: unknown): value is EvidenceEntry => {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  const span = entry.evidence_span;
  return typeof entry.summary === "string"
    && typeof entry.url === "string"
    && (entry.date === undefined || entry.date === null || typeof entry.date === "string")
    && (entry.quote === undefined || typeof entry.quote === "string")
    && (entry.block_text === undefined || entry.block_text === null || typeof entry.block_text === "string")
    && (entry.evidence_text === undefined || typeof entry.evidence_text === "string")
    && (span === undefined || (
      Array.isArray(span)
      && span.length === 2
      && span.every((position) => typeof position === "number" && Number.isInteger(position))
    ));
};

const isEvidenceProfile = (value: unknown): value is EvidenceProfile => {
  if (typeof value !== "object" || value === null) return false;
  const profile = value as Record<string, unknown>;
  if (typeof profile.cells !== "object" || profile.cells === null || Array.isArray(profile.cells)) return false;
  return Object.values(profile.cells).every(
    (entries) => Array.isArray(entries) && entries.every(isEvidenceEntry),
  );
};

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

function toEvidence(reason: MatchReason, entry: EvidenceEntry): MatchEvidence | null {
  if (entry.url.length === 0) return null;
  const base: MatchEvidence = {
    date: entry.date ?? null,
    summary: entry.summary,
    url: entry.url,
    frame: reason.frame,
    target: reason.target,
    role: reason.role,
  };

  // quote がある国会会議録だけ原文を返します。公式サイト由来には原文項目を足しません。
  if (entry.quote === undefined) return base;
  const full = entry.block_text ?? entry.quote;
  const span = entry.evidence_span;
  const highlight = span
    && span[0] >= 0
    && span[1] >= span[0]
    && span[1] <= full.length
    ? full.slice(span[0], span[1])
    : entry.evidence_text;

  return { ...base, quote: full, ...(highlight ? { highlight } : {}) };
}

function selectEvidence(profile: EvidenceProfile | null, reasons: MatchReason[]): MatchEvidence[] {
  if (!profile) return [];
  const selected: MatchEvidence[] = [];
  for (const reason of reasons) {
    const entries = profile.cells[cellKey(reason)] ?? [];
    const evidence = entries.map((entry) => toEvidence(reason, entry)).find((entry) => entry !== null);
    if (evidence) selected.push(evidence);
  }
  return selected.slice(0, 3);
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
matches.get("/profile", async (c) => {
  try {
    const rawUser = await c.env.USER_PROFILES.get<unknown>(userProfileKey(CURRENT_USER_ID), "json");

    if (rawUser === null) return c.json(unreliableResponse(CURRENT_USER_ID));
    if (!isUserProfile(rawUser) || rawUser.user_id !== CURRENT_USER_ID) {
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
      .slice(0, 3);

    if (ranked.length === 0) {
      return c.json(unreliableResponse(user.user_id, makeUserSummary(user)));
    }

    const rawEvidenceProfiles = await Promise.all(
      ranked.map(({ profile }) => c.env.PROFILES.get<unknown>(`profile:evidence:${profile.speaker_id}`, "json")),
    );
    const evidenceProfiles: (EvidenceProfile | null)[] = [];
    for (const rawEvidence of rawEvidenceProfiles) {
      if (rawEvidence !== null && !isEvidenceProfile(rawEvidence)) {
        return c.json({ status: "error", message: "根拠データの形式が不正です。" }, 500);
      }
      evidenceProfiles.push(rawEvidence);
    }

    const parties = [...new Set(candidates.map(({ profile }) => profile.party))];
    const rawPartyProfiles = await Promise.all(
      parties.map((party) => c.env.PROFILES.get<unknown>(`profile:party:${party}`, "json")),
    );
    const partyProfiles: PartyProfile[] = [];
    for (const [index, rawProfile] of rawPartyProfiles.entries()) {
      if (rawProfile === null) continue;
      if (!isPartyProfile(rawProfile) || rawProfile.party !== parties[index]) {
        return c.json({ status: "error", message: "政党プロファイルの形式が不正です。" }, 500);
      }
      partyProfiles.push(rawProfile);
    }

    const politicianResults = ranked.map(({ master, profile, result }, index) => ({
      speaker_id: profile.speaker_id,
      politician_name: profile.politician_name,
      party: profile.party,
      house: profile.house,
      website: master.website,
      match_score: result.match_score,
      matched_cells: result.matched_cells,
      reasons: result.reasons,
      differences: result.differences,
      evidence: selectEvidence(evidenceProfiles[index] ?? null, result.reasons),
    }));

    const partyResults = partyProfiles
      .flatMap((profile) => {
        const result = calculateProfileMatch(user, profile, universe);
        return result.reliable ? [{ profile, result }] : [];
      })
      .map(({ profile, result }) => ({
        party: profile.party,
        match_score: result.match_score,
        matched_cells: result.matched_cells,
        n_politicians: profile.n_politicians,
      }))
      .sort((a, b) => b.match_score - a.match_score || a.party.localeCompare(b.party, "ja"));

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
      userId: CURRENT_USER_ID,
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
