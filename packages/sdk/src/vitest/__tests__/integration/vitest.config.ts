import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { createBlockPlugin } from "../../plugin";

export default defineConfig({
  plugins: [
    createBlockPlugin(),
    {
      name: "tailor-runtime-environment-dev",
      config() {
        return {
          resolve: {
            alias: {
              "vitest-environment-tailor-runtime": resolve(__dirname, "../../environment.ts"),
            },
          },
        };
      },
    },
  ],
  test: {
    watch: false,
    environment: "tailor-runtime",
    include: ["./**/*.test.ts"],
    root: __dirname,
  },
});
