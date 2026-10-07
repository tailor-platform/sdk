import { describe, expect, test } from "vitest";
import transform, { reviewFindings } from "../codemods/v3/external-to-attach/scripts/transform";

const IMPORT = 'import { defineConfig } from "@tailor-platform/sdk";\n';

describe("Service external to attach", () => {
  test("renames service attachment settings and is idempotent", () => {
    const source =
      IMPORT +
      `export default defineConfig({
  db: {
    shared: { external: true },
    quoted: { 'external': /* keep */ true },
    own: { files: ["./tables/*.ts"] },
    referenced: { attach: false, schemaFrom: "../owner/tailor.config.ts" },
  },
  auth: { name: "auth", external: true },
  idp: [{ name: "idp", external: true }],
  resolver: { shared: { external: true } },
});
const other = { db: { shared: { external: true } } };
`;
    const expected = source
      .replace("shared: { external: true }", "shared: { attach: true }")
      .replace("'external': /* keep */ true", "'attach': /* keep */ true")
      .replace('auth: { name: "auth", external: true }', 'auth: { name: "auth", attach: true }')
      .replace('idp: [{ name: "idp", external: true }]', 'idp: [{ name: "idp", attach: true }]')
      .replace(
        "resolver: { shared: { external: true } }",
        "resolver: { shared: { attach: true } }",
      );
    expect(transform(source)).toBe(expected);
    expect(transform(expected)).toBeNull();
    expect(reviewFindings(expected, "tailor.config.ts", "tailor.config.ts")).toEqual([]);
  });

  test.each([
    ['import { defineConfig as config } from "@tailor-platform/sdk";', "config"],
    ['import * as sdk from "@tailor-platform/sdk";', "sdk.defineConfig"],
  ])("supports SDK import bindings: %s", (imports, call) => {
    const source = `${imports}\n${call}({ db: { shared: { external: true } } });`;
    expect(transform(source)).toBe(source.replace("external: true", "attach: true"));
  });

  test.each([
    'import { defineConfig } from "other"; defineConfig({ db: { ns: { external: true } } });',
    "const defineConfig = (x) => x; defineConfig({ db: { ns: { external: true } } });",
    IMPORT + "defineConfig({ db: { ns: { attach: true } } });",
    IMPORT + "defineConfig({ buildOptions: { external: true } });",
  ])("leaves unrelated or migrated settings unchanged: %s", (source) => {
    expect(transform(source)).toBeNull();
    expect(reviewFindings(source, "config.ts", "config.ts")).toEqual([]);
  });

  test.each([
    ['import { defineAuth, defineIdp } from "@tailor-platform/sdk";', "defineAuth", "defineIdp"],
    ['import { defineAuth as auth, defineIdp as idp } from "@tailor-platform/sdk";', "auth", "idp"],
    ['import * as sdk from "@tailor-platform/sdk";', "sdk.defineAuth", "sdk.defineIdp"],
  ])("does not request manual migration for owned SDK builders: %s", (imports, auth, idp) => {
    const source = `${IMPORT}${imports}
export default defineConfig({
  db: { own: { files: ["./tailordb/*.ts"] } },
  resolver: { own: { files: ["./resolvers/*.ts"] } },
  auth: ${auth}("auth", { machineUserAttributes: {}, machineUsers: [] }),
  idp: [${idp}("idp", { clients: ["default"] })],
});`;

    expect(transform(source)).toBeNull();
    expect(reviewFindings(source, "tailor.config.ts", "tailor.config.ts")).toEqual([]);
  });

  test.each([
    ['import { defineAuth } from "other";', 'defineConfig({ auth: defineAuth("auth", {}) });'],
    ['import * as sdk from "other";', 'defineConfig({ auth: sdk.defineAuth("auth", {}) });'],
    [
      'import { defineAuth } from "@tailor-platform/sdk";',
      'function build(defineAuth) { return defineConfig({ auth: defineAuth("auth", {}) }); }',
    ],
    [
      'import * as sdk from "@tailor-platform/sdk";',
      'function build(sdk) { return defineConfig({ auth: sdk.defineAuth("auth", {}) }); }',
    ],
  ])("keeps manual migration findings for unresolved builders: %s", (imports, body) => {
    const source = `${IMPORT}${imports}\n${body}`;

    expect(transform(source)).toBeNull();
    expect(reviewFindings(source, "config.ts", "config.ts")).toEqual([
      expect.objectContaining({ message: expect.stringContaining("not an object literal") }),
    ]);
  });

  test.each([
    ["config variable", "defineConfig(config)", "object literal"],
    ["config spread", "defineConfig({ ...config })", "spread or computed"],
    ["db variable", "defineConfig({ db })", "object literal"],
    ["db spread", "defineConfig({ db: { ...namespaces } })", "spread or computed"],
    ["namespace variable", "defineConfig({ db: { ns: shared } })", "object literal"],
    [
      "namespace spread",
      "defineConfig({ db: { ns: { ...shared, external: true } } })",
      "spread or computed",
    ],
    [
      "computed option",
      "defineConfig({ db: { ns: { [key]: true, external: true } } })",
      "spread or computed",
    ],
    [
      "conflicting options",
      "defineConfig({ db: { ns: { external: true, attach: true } } })",
      "other options",
    ],
    [
      "owned namespace",
      "defineConfig({ db: { ns: { external: true, files: [] } } })",
      "other options",
    ],
    ["dynamic value", "defineConfig({ db: { ns: { external: enabled } } })", "literal true"],
    ["shorthand", "defineConfig({ db: { ns: { external } } })", "literal true"],
    [
      "shadowed binding",
      "function build(defineConfig) { return defineConfig({ db: { ns: { external: true } } }); }",
      "declared again",
    ],
  ])("reports %s for manual migration", (_name, body, reason) => {
    const source = IMPORT + body;
    expect(transform(source)).toBeNull();
    expect(reviewFindings(source, "/repo/config.ts", "config.ts")).toEqual([
      expect.objectContaining({ file: "config.ts", message: expect.stringContaining(reason) }),
    ]);
  });
});
