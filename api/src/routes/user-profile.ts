import { Hono } from "hono";
import {
  CELL_ROLES,
  FRAMES,
  TARGETS,
  userProfileKey,
  type UserProfile,
} from "@civic-compass/shared";
import type { AppEnv } from "../bindings";
import { requireCurrentUser } from "../session";

const userProfile = new Hono<AppEnv>();

userProfile.use("*", requireCurrentUser);

type ProfileCell = UserProfile["cells"][number];

/**
 * 表示順は `score`（その価値をどれだけ強く優先したか）の降順。
 *
 * ⚠ `score` は同点になりやすい。設問1問につき1セルなので、いまの設問カタログでは
 *   `score` は uphold なら +1、override なら −1 の2値にしかならない（同じセルを
 *   複数の記事で問うようになると初めて中間値が出る）。同点は `share`（言及度）で
 *   割り、それでも並ばないときだけセルキーの辞書順で固定する。
 */
const compareCells = (a: ProfileCell, b: ProfileCell): number =>
  b.score - a.score
  || b.share - a.share
  || a.frame.localeCompare(b.frame)
  || a.target.localeCompare(b.target, "ja")
  || a.role.localeCompare(b.role);

const isProfileCell = (value: unknown): value is ProfileCell => {
  if (typeof value !== "object" || value === null) return false;
  const cell = value as Record<string, unknown>;
  return typeof cell.frame === "string"
    && FRAMES.includes(cell.frame as ProfileCell["frame"])
    && typeof cell.target === "string"
    && TARGETS.includes(cell.target as ProfileCell["target"])
    && typeof cell.role === "string"
    && CELL_ROLES.includes(cell.role as ProfileCell["role"])
    && typeof cell.score === "number" && Number.isFinite(cell.score)
    && typeof cell.share === "number" && Number.isFinite(cell.share)
    && typeof cell.n === "number" && Number.isFinite(cell.n);
};

/**
 * 現在のユーザーがよく使う考え方を、`score` の上位3件に絞って返します。
 *
 * ★`score > 0` のセルだけを返します。負のセルは「その価値を持ち出したうえで
 *   優先順位を下げた」ことを表すので、「あなたが重視している考え方」として並べると
 *   意味が逆になります。3件に満たなければ、あるぶんだけ返します（0件なら空配列で、
 *   画面側が回答を促す文言を出します）。
 */
userProfile.get("/", async (c) => {
  const currentUserId = c.get("currentUser").userId;
  const raw = await c.env.USER_PROFILES.get(userProfileKey(currentUserId));
  if (raw === null) return c.json({ cells: [] });

  let profile: Partial<UserProfile>;
  try {
    profile = JSON.parse(raw) as Partial<UserProfile>;
  } catch {
    return c.json({ status: "error", message: "User profile is invalid" }, 500);
  }

  if (!Array.isArray(profile.cells) || !profile.cells.every(isProfileCell)) {
    return c.json({ status: "error", message: "User profile is invalid" }, 500);
  }

  return c.json({ cells: profile.cells.filter((cell) => cell.score > 0).sort(compareCells).slice(0, 3) });
});

export default userProfile;
