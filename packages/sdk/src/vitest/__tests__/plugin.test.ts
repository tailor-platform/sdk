import { beforeAll, describe, expect, test } from "vitest";
import { createBlockPlugin } from "../plugin";
import type { ResolvedConfig } from "vite";

describe("createBlockPlugin", () => {
  const plugin = createBlockPlugin();
  const configResolved = plugin.configResolved as (config: ResolvedConfig) => void;
  const transform = plugin.transform as (code: string, id: string) => { code: string } | undefined;

  beforeAll(() => {
    configResolved({
      test: { include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"] },
    } as unknown as ResolvedConfig);
  });

  describe("transform", () => {
    test("replaces node:* imports with throw in production code", () => {
      const code = 'import { randomUUID } from "node:crypto";\nconsole.log(randomUUID());';
      const result = transform(code, "/app/src/resolver/myResolver.ts");
      expect(result).toBeDefined();
      expect(result!.code).toContain("throw new Error");
      expect(result!.code).toContain("node:crypto");
      expect(result!.code).toContain("Web Crypto API");
    });

    test("replaces bare specifier imports in production code", () => {
      const code = 'import { readFileSync } from "fs";\nreadFileSync("test");';
      const result = transform(code, "/app/src/resolver/myResolver.ts");
      expect(result).toBeDefined();
      expect(result!.code).toContain("throw new Error");
      expect(result!.code).toContain("fs");
    });

    test("does not transform test files", () => {
      const code = 'import { randomUUID } from "node:crypto";';
      expect(transform(code, "/app/src/resolver/myResolver.test.ts")).toBeUndefined();
      expect(transform(code, "/app/tests/helper.spec.ts")).toBeUndefined();
    });

    test("does not transform node_modules", () => {
      const code = 'import { randomUUID } from "node:crypto";';
      expect(transform(code, "/app/node_modules/some-lib/index.js")).toBeUndefined();
    });

    test("does not transform code without blocked imports", () => {
      const code = 'import { something } from "./local";\nconsole.log(something);';
      expect(transform(code, "/app/src/resolver/myResolver.ts")).toBeUndefined();
    });

    test("preserves non-blocked imports alongside blocked ones", () => {
      const code = [
        'import { something } from "./local";',
        'import { randomUUID } from "node:crypto";',
        "console.log(something, randomUUID());",
      ].join("\n");
      const result = transform(code, "/app/src/resolver/myResolver.ts");
      expect(result).toBeDefined();
      expect(result!.code).toContain('./local"');
      expect(result!.code).toContain("throw new Error");
    });
  });
});
