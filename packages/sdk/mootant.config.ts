import { defineConfig } from "mootant";
import { vitestAdapter } from "mootant/vitest";

export default defineConfig({
  run: {
    runner: vitestAdapter({ config: "vitest.mutation.config.ts" }),
  },
});
