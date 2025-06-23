import { defineConfig } from "tsup";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  entry: ["src/cli/*", "src/index.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  dts: true,
  clean: true,
  shims: true,
  splitting: false,
  bundle: true,
  skipNodeModulesBundle: true,
  outExtension({ format }: { format: "esm" | "cjs" | "iife" }) {
    return {
      js: `.${format === "esm" ? "mjs" : "js"}`,
    };
  },
});
