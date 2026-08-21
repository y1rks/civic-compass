// リポジトリ全体のESLint設定。frontend / api / db をまとめて対象にします。
// VSCode の ESLint 拡張もこのファイルを読むため、保存時のチェックが全ワークスペースで効きます。
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

// 意図的に使わない引数・変数は `_` で始めることで警告を抑制できます。
const unusedVarsRule = {
  "@typescript-eslint/no-unused-vars": [
    "warn",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
    },
  ],
};

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/.next/**",
    "**/.vinext/**",
    "**/.wrangler/**",
    "**/out/**",
    "**/next-env.d.ts",
    // drizzle-kit が生成するファイルは対象外にします。
    "db/migrations/**",
  ]),

  // 画面 (React / Next.js 互換)
  {
    files: ["frontend/**/*.{js,jsx,mjs,ts,tsx}"],
    extends: [nextVitals, nextTs],
    settings: {
      // ルートから実行するため、Next.js のルートを明示します。
      next: { rootDir: "frontend" },
    },
    rules: unusedVarsRule,
  },

  // API と DBスキーマ (素の TypeScript)
  {
    files: ["api/**/*.ts", "db/**/*.ts"],
    extends: [tseslint.configs.recommended],
    rules: unusedVarsRule,
  },

  // 設定ファイル類
  {
    files: ["*.mjs", "*/drizzle.config.ts", "*/vite.config.ts"],
    extends: [tseslint.configs.recommended],
    rules: unusedVarsRule,
  },
]);
