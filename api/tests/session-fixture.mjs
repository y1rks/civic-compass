import assert from "node:assert/strict";

export const TEST_SESSION_TOKEN = "a".repeat(64);
export const TEST_COOKIE = `__Host-civic_session=${TEST_SESSION_TOKEN}`;

/** ユーザー依存APIの前段で行われるセッション検索だけを補うD1モックです。 */
export function withSessionDb(db = {}, user = { user_id: "test_user1", name: "テストユーザー" }) {
  return {
    ...db,
    prepare(query) {
      if (/FROM user_sessions AS s/i.test(query)) {
        const statement = {
          bind(tokenHash, now) {
            assert.match(tokenHash, /^[0-9a-f]{64}$/);
            assert.ok(!Number.isNaN(Date.parse(now)));
            return statement;
          },
          first: async () => user,
        };
        return statement;
      }
      return db.prepare(query);
    },
  };
}

export function withSessionCookie(init = {}) {
  return {
    ...init,
    headers: {
      ...Object.fromEntries(new Headers(init.headers).entries()),
      cookie: TEST_COOKIE,
    },
  };
}
