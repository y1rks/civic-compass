import { Hono } from "hono";
import {
  CELL_ROLES,
  FRAMES,
  TARGETS,
  userProfileKey,
  type UserProfile,
} from "@civic-compass/shared";
import type { AppEnv } from "../bindings";
import { CURRENT_USER_ID } from "../current-user";

const userProfile = new Hono<AppEnv>();

type ProfileCell = UserProfile["cells"][number];

const compareCells = (a: ProfileCell, b: ProfileCell): number =>
  b.share - a.share
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

/** 現在のユーザーがよく使う考え方を、重視度（share）の上位3件に絞って返します。 */
userProfile.get("/", async (c) => {
  const raw = await c.env.USER_PROFILES.get(userProfileKey(CURRENT_USER_ID));
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

  return c.json({ cells: [...profile.cells].sort(compareCells).slice(0, 3) });
});

export default userProfile;
