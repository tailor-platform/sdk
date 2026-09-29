import { describe, expect, test } from "vitest";
import transform, {
  reviewFindings,
} from "../codemods/v3/define-config-build-options/scripts/transform";

const IMPORT = 'import { defineConfig } from "@tailor-platform/sdk";\n';

const review = (body: string) => {
  const source = IMPORT + body;
  return {
    transformed: transform(source, "tailor.config.ts"),
    findings: reviewFindings(source, "tailor.config.ts", "tailor.config.ts"),
  };
};

describe("defineConfig top-level options -> buildOptions migration review", () => {
  test("rewrites a literal config and reports nothing left to review", () => {
    const { transformed, findings } = review(
      'export default defineConfig({\n  name: "my-app",\n  logLevel: "WARN",\n});\n',
    );

    expect(transformed).toContain('buildOptions: {\n    logLevel: "WARN",\n  },');
    expect(findings).toEqual([]);
  });

  test("reports nothing for a config that sets neither option", () => {
    expect(review('export default defineConfig({\n  name: "my-app",\n});\n')).toEqual({
      transformed: null,
      findings: [],
    });
  });

  test.each([
    [
      "a config passed as a variable",
      'const config = { name: "my-app", logLevel: "WARN" };\nexport default defineConfig(config);\n',
      "not an object literal",
    ],
    [
      "a config composed with a spread",
      'export default defineConfig({\n  ...base,\n  logLevel: "WARN",\n});\n',
      "spread or computed key",
    ],
    [
      "a config written on a single line",
      'export default defineConfig({ name: "my-app", logLevel: "WARN" });\n',
      "shares its line",
    ],
    [
      "a buildOptions passed as a variable",
      'export default defineConfig({\n  logLevel: "WARN",\n  buildOptions,\n});\n',
      "not written as an object literal",
    ],
    [
      "an option set both at the top level and in buildOptions",
      'export default defineConfig({\n  logLevel: "WARN",\n  buildOptions: {\n    logLevel: "ERROR",\n  },\n});\n',
      "both at the top level and in buildOptions",
    ],
    [
      "a buildOptions written on a single line",
      'export default defineConfig({\n  logLevel: "WARN",\n  buildOptions: { inlineSourcemap: false },\n});\n',
      "single line",
    ],
    [
      "a call to a local binding that shadows the imported defineConfig",
      'export const build = (defineConfig) =>\n  defineConfig({\n    logLevel: "WARN",\n  });\n',
      "declared again in this file",
    ],
  ])("leaves %s unchanged and flags it for review", (_name, body, reason) => {
    const { transformed, findings } = review(body);

    expect(transformed).toBeNull();
    expect(findings).toEqual([
      expect.objectContaining({ message: expect.stringContaining(reason) }),
    ]);
  });
});
