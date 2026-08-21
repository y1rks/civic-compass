import vinext from "vinext";
import { defineConfig } from "vite";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  // api/wrangler.jsonc の d1_databases と binding 名・database_name を揃えます。
  // これと persistState の組み合わせで、api と同じローカルDBを参照します。
  d1_databases: [
    {
      binding: "DB",
      database_name: "civic-compass-db",
      database_id: "00000000-0000-0000-0000-000000000000",
    },
  ],
};

// ローカルDBの保存先。api 側は `wrangler dev --persist-to ../.wrangler/state` で
// 同じ場所を指しているため、frontend と api が同一のD1を読み書きします。
const sharedPersistPath = "../.wrangler/state";

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      // `/api/*` は api ワークスペースの Worker (wrangler dev) へ転送します。
      // 同一オリジン扱いになるため、フロント側で CORS を意識する必要がありません。
      // ポートは api/wrangler.jsonc の dev.port と揃えます。
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8000",
          changeOrigin: true,
        },
      },
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
        persistState: { path: sharedPersistPath },
      }),
    ],
  };
});
