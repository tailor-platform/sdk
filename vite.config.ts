import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: [
      "**/CHANGELOG.md",
      "example/tests/fixtures/",
      "example/seed/",
      "packages/tailor-proto/",
      "generated/",
    ],
  },
});
