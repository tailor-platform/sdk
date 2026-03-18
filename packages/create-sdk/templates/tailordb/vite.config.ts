import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["src/generated/", "pnpm-lock.yaml"],
  },
});
