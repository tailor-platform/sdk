import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: [
      "**/CHANGELOG.md",
      "node_modules/",
      "pnpm-lock.yaml",
      "dist/",
      "build/",
      "out/",
      "*.tsbuildinfo",
      "logs",
      "*.log",
      "npm-debug.log*",
      "yarn-debug.log*",
      "yarn-error.log*",
      "pnpm-debug.log*",
      "lerna-debug.log*",
      ".eslintcache",
      "coverage/",
      ".tailor-sdk",
      "example/tests/fixtures/",
      "example/seed/",
      "packages/tailor-proto/",
      "generated/",
    ],
  },
});
