import path from "node:path";
import { defineConfig } from "vitest/config";
import * as swc from "@swc/core";

export default defineConfig({
  esbuild: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@tailor-proto": path.resolve(__dirname, "../tailor-proto/src"),
    },
  },
  plugins: [
    {
      name: "swc",
      transform(code, file) {
        if (/^.ts$/.test(path.extname(file))) {
          return swc.transform(code, {
            jsc: {
              parser: { syntax: "typescript", decorators: true },
              transform: { decoratorMetadata: true },
            },
          });
        }
      },
    },
  ],
  test: {
    environment: "node",
    include: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
    globals: true,
    watch: false,
  },
});
