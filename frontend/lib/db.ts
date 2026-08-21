// フロントエンド (Server Component / Server Action) から D1 を参照するための入口。
//
// クライアントコンポーネント ("use client") からは呼べません。
// ブラウザ側で必要なデータは、api ワークスペース経由 (`fetch("/api/...")`) か、
// Server Component で取得して props で渡してください。
import { env } from "cloudflare:workers";
import { createDb, type Db } from "@civic-compass/db";

export function getDb(): Db {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 バインディング `DB` が見つかりません。frontend/vite.config.ts の d1_databases を確認してください。",
    );
  }

  return createDb(env.DB);
}

export * from "@civic-compass/db";
