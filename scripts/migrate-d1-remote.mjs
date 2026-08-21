import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const migrationsUrl = new URL("../db/migrations/", import.meta.url);
let migrationFiles = [];

try {
  migrationFiles = (await readdir(migrationsUrl, { recursive: true }))
    .filter((path) => path.endsWith(".sql"));
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}

if (migrationFiles.length === 0) {
  console.log("D1 migrations: no SQL files; skipping.");
  process.exit(0);
}

const result = spawnSync("npm", ["run", "db:migrate:remote"], {
  cwd: new URL("..", import.meta.url),
  env: process.env,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
