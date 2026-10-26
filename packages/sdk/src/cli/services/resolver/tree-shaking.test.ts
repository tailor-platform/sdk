import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
import { bundleResolvers } from "./bundler";

interface BundleResolverOptions {
  /** Extra project files, keyed by path relative to the project root */
  files?: Record<string, string>;
  bundleTreeshake?: Parameters<typeof bundleResolvers>[0]["bundleTreeshake"];
}

async function bundleResolverWith(prelude: string, options: BundleResolverOptions = {}) {
  using tmp = tempCwd("sdk-tree-shaking-");
  const scopeDir = path.join(tmp.dir, "node_modules/@tailor-platform");
  fs.mkdirSync(scopeDir, { recursive: true });
  fs.symlinkSync(path.resolve(__dirname, "../../../.."), path.join(scopeDir, "sdk"), "dir");
  for (const [name, content] of Object.entries(options.files ?? {})) {
    fs.mkdirSync(path.dirname(path.join(tmp.dir, name)), { recursive: true });
    fs.writeFileSync(path.join(tmp.dir, name), content);
  }
  fs.writeFileSync(
    path.join(tmp.dir, "resolver.mjs"),
    `
    import { createResolver, db, t } from "@tailor-platform/sdk";
    ${prelude}
    export default createResolver({
      name: "add",
      operation: "query",
      input: { a: t.int(), b: t.int() },
      body: ({ input }) => input.a + input.b,
      output: t.int(),
    });
  `,
  );

  return (
    await bundleResolvers({
      namespace: "treeshake",
      files: fs.globSync(path.resolve(tmp.dir, "./resolver.mjs")),
      baseDir: tmp.dir,
      bundleTreeshake: options.bundleTreeshake,
    })
  ).get("add")!;
}

describe("resolver bundle tree-shaking", () => {
  test("leaves TailorDB schema builders out of resolvers that do not use them", async () => {
    const code = await bundleResolverWith("");

    expect(code).not.toContain("pickFields()");
    expect(code).not.toContain("[object Float64Array]");
  });

  describe("SDK builder chains", () => {
    const define = `const define = /* @__NO_SIDE_EFFECTS__ */ (options) => ({ options });`;

    test("drops an unused call whose arguments hold db and t builder chains", async () => {
      const code = await bundleResolverWith(`
        ${define}
        const unused = define({
          field: db.string().index().description("UNUSED_FIELD"),
          output: t.object({ id: t.uuid() }).description("UNUSED_OUTPUT"),
        });
      `);

      expect(code).not.toContain("UNUSED_FIELD");
      expect(code).not.toContain("UNUSED_OUTPUT");
    });

    test("keeps a side effect in the arguments of an inner chain call", async () => {
      const code = await bundleResolverWith(`
        ${define}
        const unused = define({
          field: db.string().description(globalThis.describeField?.("x")).index(),
        });
      `);

      expect(code).toContain("describeField");
    });

    test("leaves builder chains in installed packages alone", async () => {
      const code = await bundleResolverWith(`import { helper } from "schema-lib";\nhelper();`, {
        files: {
          "node_modules/schema-lib/package.json": JSON.stringify({
            name: "schema-lib",
            type: "module",
            exports: { ".": "./index.js" },
          }),
          "node_modules/schema-lib/index.js": `
            import { db } from "@tailor-platform/sdk";
            ${define}
            define({ field: db.string().description("PACKAGE_FIELD") });
            export const helper = () => globalThis.helperMarker;
          `,
        },
      });

      expect(code).toContain("PACKAGE_FIELD");
    });
  });

  describe("treeshake options", () => {
    function bundleWithUnusedPropertyRead(
      bundleTreeshake?: BundleResolverOptions["bundleTreeshake"],
    ) {
      return bundleResolverWith(
        `
        const make = /* @__NO_SIDE_EFFECTS__ */ (value) => ({ value });
        const source = globalThis.propertyReadMarker ?? { nested: { value: 1 } };
        const unused = make(source.nested.value);
      `,
        { bundleTreeshake },
      );
    }

    test("keeps an unused call whose argument reads properties by default", async () => {
      expect(await bundleWithUnusedPropertyRead()).toContain("propertyReadMarker");
    });

    test("drops that call when propertyReadSideEffects is false", async () => {
      expect(await bundleWithUnusedPropertyRead({ propertyReadSideEffects: false })).not.toContain(
        "propertyReadMarker",
      );
    });
  });
});
