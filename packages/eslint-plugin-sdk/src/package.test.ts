import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("package", () => {
  test("publishes the generated JavaScript and declaration entry points", () => {
    expect(packageJson).toMatchObject({
      files: ["dist", "README.md"],
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
          default: "./dist/index.js",
        },
      },
      scripts: {
        build: "tsdown",
        pretest: "pnpm run build",
        prepack: "pnpm run build",
      },
    });
  });

  test("typechecks source without rebuilding generated output", () => {
    expect(packageJson.devDependencies).toMatchObject({ "@types/node": "24.13.3" });
    expect(packageJson.scripts).not.toHaveProperty("pretypecheck");
  });
});
