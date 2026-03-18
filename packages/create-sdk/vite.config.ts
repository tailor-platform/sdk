import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    format: ["esm"],
    target: "node18",
    platform: "node",
    clean: true,
    outDir: "dist",
    tsconfig: "./tsconfig.json",
    outExtensions: () => ({
      js: ".js",
    }),
  },
});
