import { readFile } from "node:fs/promises";

const config = await readFile(new URL("../api/wrangler.jsonc", import.meta.url), "utf8");
const databaseId = config.match(/"database_id"\s*:\s*"([^"]+)"/)?.[1];
const placeholderId = "00000000-0000-0000-0000-000000000000";

if (!databaseId || databaseId === placeholderId) {
  throw new Error(
    "api/wrangler.jsonc の database_id を、Cloudflare D1 が発行した実際の ID に置き換えてください。",
  );
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!uuidPattern.test(databaseId)) {
  throw new Error("api/wrangler.jsonc の database_id は UUID 形式で指定してください。");
}

if (process.env.GITHUB_ACTIONS === "true") {
  for (const name of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]) {
    if (!process.env[name]) {
      throw new Error(`GitHub Actions secret ${name} が設定されていません。`);
    }
  }
}

console.log("Cloudflare deployment configuration is ready.");
