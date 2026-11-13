import { describe, expect, test } from "vitest";
import transform, { reviewFindings } from "../codemods/v3/idp-array-to-single/scripts/transform";

const IMPORT = 'import { defineConfig, defineIdp } from "@tailor-platform/sdk";\n';

const review = (body: string) => {
  const source = IMPORT + body;
  return {
    transformed: transform(source, "tailor.config.ts"),
    findings: reviewFindings(source, "tailor.config.ts", "tailor.config.ts"),
  };
};

describe("idp array -> single IdP migration review", () => {
  test("rewrites a one-element array and reports nothing left to review", () => {
    const { transformed, findings } = review(
      'export default defineConfig({\n  name: "shop",\n  idp: [shopIdp],\n});\n',
    );

    expect(transformed).toContain("idp: shopIdp,");
    expect(findings).toEqual([]);
  });

  test("reports nothing for a config that is already migrated or has no idp", () => {
    expect(
      review('export default defineConfig({\n  name: "shop",\n  idp: shopIdp,\n});\n'),
    ).toEqual({ transformed: null, findings: [] });
    expect(review('export default defineConfig({\n  name: "shop",\n});\n')).toEqual({
      transformed: null,
      findings: [],
    });
  });

  test.each([
    [
      "an array of two own IdPs",
      "export default defineConfig({\n  idp: [shopIdp, customerIdp],\n});\n",
      "declares 2 IdPs",
    ],
    [
      "an own IdP and an external declaration",
      'export default defineConfig({\n  idp: [shopIdp, { name: "backoffice-idp", external: true }],\n});\n',
      "declares 2 IdPs",
    ],
    [
      "an array built with a spread",
      "export default defineConfig({\n  idp: [...idps],\n});\n",
      "spread",
    ],
    [
      "an array with a comment inside",
      "export default defineConfig({\n  idp: [\n    // the shop IdP\n    shopIdp,\n  ],\n});\n",
      "comment",
    ],
    [
      "an empty array on the same line as other code",
      "export default defineConfig({ idp: [] });\n",
      "shares its line",
    ],
    [
      "a config passed as a variable",
      "const config = { idp: [shopIdp] };\nexport default defineConfig(config);\n",
      "not an object literal",
    ],
  ])("reports %s for a manual migration", (_name, body, reason) => {
    const { transformed, findings } = review(body);

    expect(transformed).toBeNull();
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain(reason);
  });

  test.each([
    [
      "an idp value that is a local array",
      "const idps = [shopIdp];\nexport default defineConfig({\n  idp: idps,\n});\n",
      "declared as an array",
    ],
    [
      "a shorthand idp that is a local array",
      "const idp = [shopIdp];\nexport default defineConfig({\n  idp,\n});\n",
      "declared as an array",
    ],
    [
      "a spread that may carry an idp array",
      'export default defineConfig({\n  ...base,\n  name: "shop",\n});\n',
      "spread",
    ],
  ])("reports %s for a manual migration", (_name, body, reason) => {
    const { transformed, findings } = review(body);

    expect(transformed).toBeNull();
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain(reason);
  });

  test.each([
    ["an array in parentheses", "export default defineConfig({\n  idp: ([shopIdp]),\n});\n"],
    [
      "an array with satisfies",
      "export default defineConfig({\n  idp: [shopIdp] satisfies IdPConfig[],\n});\n",
    ],
    ["an array with as const", "export default defineConfig({\n  idp: [shopIdp] as const,\n});\n"],
  ])("reports %s for a manual migration because it is wrapped", (_name, body) => {
    const { transformed, findings } = review(body);

    expect(transformed).toBeNull();
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("wrapped");
  });

  test.each([
    [
      "an array in the true branch of a conditional",
      "export default defineConfig({\n  idp: enabled ? [shopIdp] : undefined,\n});\n",
    ],
    [
      "an array in the false branch of a conditional",
      "export default defineConfig({\n  idp: enabled ? shopIdp : [shopIdp, customerIdp],\n});\n",
    ],
    ["an array after ??", "export default defineConfig({\n  idp: override ?? [shopIdp],\n});\n"],
    ["an array after &&", "export default defineConfig({\n  idp: enabled && [shopIdp],\n});\n"],
    [
      "a local array in a conditional branch",
      "const idps = [shopIdp];\nexport default defineConfig({\n  idp: enabled ? idps : undefined,\n});\n",
    ],
    [
      "an array in a nested conditional",
      "export default defineConfig({\n  idp: a ? shopIdp : b ? [shopIdp] : undefined,\n});\n",
    ],
  ])("reports %s for a manual migration", (_name, body) => {
    const { transformed, findings } = review(body);

    expect(transformed).toBeNull();
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("branch");
  });

  test("leaves a conditional whose branches are single IdPs alone", () => {
    expect(
      review("export default defineConfig({\n  idp: enabled ? shopIdp : customerIdp,\n});\n"),
    ).toEqual({ transformed: null, findings: [] });
    expect(
      review("export default defineConfig({\n  idp: enabled ? shopIdp : undefined,\n});\n"),
    ).toEqual({ transformed: null, findings: [] });
  });

  test("reports an idp that names a local array declared with as const", () => {
    const { transformed, findings } = review(
      "const idps = [shopIdp] as const;\nexport default defineConfig({\n  idp: idps,\n});\n",
    );

    expect(transformed).toBeNull();
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("declared as an array");
  });

  test("leaves an idp in parentheses that is a single IdP alone", () => {
    expect(review("export default defineConfig({\n  idp: (shopIdp),\n});\n")).toEqual({
      transformed: null,
      findings: [],
    });
  });

  test.each([
    [
      "an empty array after a spread",
      "export default defineConfig({\n  ...base,\n  idp: [],\n});\n",
      "an earlier spread",
    ],
    [
      "a spread after an idp that is written out",
      "export default defineConfig({\n  idp: shopIdp,\n  ...base,\n});\n",
      "a later spread",
    ],
    [
      "a spread after a one-element array",
      "export default defineConfig({\n  idp: [shopIdp],\n  ...base,\n});\n",
      "a later spread",
    ],
  ])(
    "reports %s for a manual migration because it may change which idp applies",
    (_name, body, reason) => {
      const { transformed, findings } = review(body);

      expect(transformed).toBeNull();
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain(reason);
    },
  );

  test("keeps the contents of a multiline template literal when it moves the element", () => {
    const { transformed } = review(
      [
        "export default defineConfig({",
        "  idp: [",
        '    defineIdp("my-idp", {',
        "      description: `first",
        "    second`,",
        '      clients: ["c"],',
        "    }),",
        "  ],",
        "});",
        "",
      ].join("\n"),
    );

    expect(transformed).toContain("`first\n    second`");
    expect(transformed).toContain('  idp: defineIdp("my-idp", {\n');
  });

  test.each([
    [
      "an idp that is a single IdP declared in the file",
      'const idp = defineIdp("shop-idp", { clients: ["c"] });\nexport default defineConfig({\n  idp,\n});\n',
    ],
    [
      "an idp that is imported",
      'import { shopIdp } from "./idp";\nexport default defineConfig({\n  idp: shopIdp,\n});\n',
    ],
    [
      "a spread next to an idp written out",
      "export default defineConfig({\n  ...base,\n  idp: shopIdp,\n});\n",
    ],
  ])("reports nothing for %s", (_name, body) => {
    expect(review(body)).toEqual({ transformed: null, findings: [] });
  });

  test("tells how to drop an external declaration that only exists to subscribe", () => {
    const { findings } = review(
      'export default defineConfig({\n  idp: [shopIdp, { name: "backoffice-idp", external: true }],\n});\n',
    );

    expect(findings[0]?.message).toContain("external declaration");
    expect(findings[0]?.message).toContain("idp option of the trigger");
  });

  test("reports the line and excerpt of the idp entry", () => {
    const { findings } = review(
      'export default defineConfig({\n  name: "shop",\n  idp: [shopIdp, customerIdp],\n});\n',
    );

    expect(findings[0]).toMatchObject({
      file: "tailor.config.ts",
      line: 4,
      excerpt: "idp: [shopIdp, customerIdp]",
    });
  });
});
