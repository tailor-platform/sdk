import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    target: "node18",
    outExtensions: () => ({
      js: ".js",
    }),
  },
});
