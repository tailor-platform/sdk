import { describe, expect, test } from "vitest";
import transform, {
  reviewFindings,
} from "../codemods/v3/tailordb-namespace-loaded-rename/scripts/transform";

describe("onNamespaceLoaded -> onTailorDBNamespaceLoaded migration review", () => {
  test("renames the hook and reports nothing left to review", () => {
    const source = `import type { Plugin } from "@tailor-platform/sdk";
export const plugin: Plugin = { id: "a", description: "a", importPath: "a", onNamespaceLoaded: () => ({}) };
`;

    expect(transform(source, "plugin.ts")).toContain("onTailorDBNamespaceLoaded: () => ({})");
    expect(reviewFindings(source, "plugin.ts", "src/plugin.ts")).toEqual([]);
  });

  test("flags a plugin object that already defines both names instead of renaming", () => {
    const source = `import type { Plugin } from "@tailor-platform/sdk";
export const plugin: Plugin = {
  id: "a",
  description: "a",
  importPath: "a",
  onTailorDBNamespaceLoaded: () => ({}),
  onNamespaceLoaded: () => ({}),
};
`;

    expect(transform(source, "plugin.ts")).toBeNull();
    expect(reviewFindings(source, "plugin.ts", "src/plugin.ts")).toEqual([
      {
        file: "src/plugin.ts",
        line: 7,
        message:
          "This defines both onTailorDBNamespaceLoaded and the deprecated onNamespaceLoaded, which the SDK rejects; merge onNamespaceLoaded into onTailorDBNamespaceLoaded and delete it.",
        excerpt: "onNamespaceLoaded: () => ({})",
      },
    ]);
  });

  test("flags a class that already defines both methods", () => {
    const source = `import type { Plugin } from "@tailor-platform/sdk";
export class Both implements Plugin {
  readonly id = "a";
  readonly description = "a";
  onTailorDBNamespaceLoaded() { return {}; }
  onNamespaceLoaded() { return {}; }
}
`;

    expect(transform(source, "plugin.ts")).toBeNull();
    expect(reviewFindings(source, "plugin.ts", "src/plugin.ts").map((f) => f.line)).toEqual([6]);
  });

  test("flags an interface that declares both names", () => {
    const source = `import type { Plugin } from "@tailor-platform/sdk";
interface Hooks extends Plugin {
  onTailorDBNamespaceLoaded?(): object;
  onNamespaceLoaded?(): object;
}
`;

    expect(transform(source, "plugin.ts")).toBeNull();
    expect(reviewFindings(source, "plugin.ts", "src/plugin.ts").map((f) => f.line)).toEqual([4]);
  });
});
