import { describe, expect, test } from "vitest";
import { reviewThroughRunner } from "./test-helpers/codemods";

const review = (source: string) =>
  reviewThroughRunner("v3/tailordb-namespace-loaded-rename", source, "src/plugin.ts");

describe("onNamespaceLoaded -> onTailorDBNamespaceLoaded migration review", () => {
  test("renames the hook and reports nothing left to review", async () => {
    const source = `import type { Plugin } from "@tailor-platform/sdk";
export const plugin: Plugin = { id: "a", description: "a", importPath: "a", onNamespaceLoaded: () => ({}) };
`;

    const { transformed, findings } = await review(source);

    expect(transformed).toContain("onTailorDBNamespaceLoaded: () => ({})");
    expect(findings).toEqual([]);
  });

  test("flags a plugin object that already defines both names instead of renaming", async () => {
    const source = `import type { Plugin } from "@tailor-platform/sdk";
export const plugin: Plugin = {
  id: "a",
  description: "a",
  importPath: "a",
  onTailorDBNamespaceLoaded: () => ({}),
  onNamespaceLoaded: () => ({}),
};
`;

    const { transformed, findings } = await review(source);

    expect(transformed).toBeNull();
    expect(findings).toEqual([
      {
        file: "src/plugin.ts",
        line: 7,
        message:
          "This defines both onTailorDBNamespaceLoaded and the deprecated onNamespaceLoaded, which the SDK rejects; merge onNamespaceLoaded into onTailorDBNamespaceLoaded and delete it.",
        excerpt: "onNamespaceLoaded: () => ({})",
      },
    ]);
  });

  test("flags a class that already defines both methods", async () => {
    const source = `import type { Plugin } from "@tailor-platform/sdk";
export class Both implements Plugin {
  readonly id = "a";
  readonly description = "a";
  onTailorDBNamespaceLoaded() { return {}; }
  onNamespaceLoaded() { return {}; }
}
`;

    const { transformed, findings } = await review(source);

    expect(transformed).toBeNull();
    expect(findings.map((f) => f.line)).toEqual([6]);
  });

  test("flags an interface that declares both names", async () => {
    const source = `import type { Plugin } from "@tailor-platform/sdk";
interface Hooks extends Plugin {
  onTailorDBNamespaceLoaded?(): object;
  onNamespaceLoaded?(): object;
}
`;

    const { transformed, findings } = await review(source);

    expect(transformed).toBeNull();
    expect(findings.map((f) => f.line)).toEqual([4]);
  });
});
