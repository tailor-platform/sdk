import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("package", () => {
  test("configures generated package entry points and build lifecycles", () => {
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
        publint: "pnpm run build && publint --strict && tsc --noEmit --project tsconfig.dist.json",
      },
    });
  });

  test("configures source typechecking without a build lifecycle", () => {
    expect(packageJson.devDependencies["@types/node"]).toEqual(expect.any(String));
    expect(packageJson.scripts.typecheck).toBe("tsc --noEmit");
    expect(packageJson.scripts).not.toHaveProperty("pretypecheck");
  });
});
