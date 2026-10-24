import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
import { bundleResolvers } from "./bundler";

describe("resolver bundle tree-shaking", () => {
  test("leaves TailorDB schema builders out of resolvers that do not use them", async () => {
    using tmp = tempCwd("sdk-tree-shaking-");
    const scopeDir = path.join(tmp.dir, "node_modules/@tailor-platform");
    fs.mkdirSync(scopeDir, { recursive: true });
    fs.symlinkSync(path.resolve(__dirname, "../../../.."), path.join(scopeDir, "sdk"), "dir");
    fs.writeFileSync(
      path.join(tmp.dir, "resolver.mjs"),
      `
      import { createResolver, t } from "@tailor-platform/sdk";
      export default createResolver({
        name: "add",
        operation: "query",
        input: { a: t.int(), b: t.int() },
        body: ({ input }) => input.a + input.b,
        output: t.int(),
      });
    `,
    );

    const code = (
      await bundleResolvers({
        namespace: "treeshake",
        files: fs.globSync(path.resolve(tmp.dir, "./resolver.mjs")),
        baseDir: tmp.dir,
      })
    ).get("add")!;

    expect(code).not.toContain("pickFields()");
    expect(code).not.toContain("[object Float64Array]");
  });

  describe("treeshake options", () => {
    async function bundleWithUnusedPropertyRead(
      bundleTreeshake?: Parameters<typeof bundleResolvers>[0]["bundleTreeshake"],
    ) {
      using tmp = tempCwd("sdk-treeshake-options-");
      const scopeDir = path.join(tmp.dir, "node_modules/@tailor-platform");
      fs.mkdirSync(scopeDir, { recursive: true });
      fs.symlinkSync(path.resolve(__dirname, "../../../.."), path.join(scopeDir, "sdk"), "dir");
      fs.writeFileSync(
        path.join(tmp.dir, "resolver.mjs"),
        `
        import { createResolver, t } from "@tailor-platform/sdk";
        const make = /* @__NO_SIDE_EFFECTS__ */ (value) => ({ value });
        const source = globalThis.propertyReadMarker ?? { nested: { value: 1 } };
        const unused = make(source.nested.value);
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
          namespace: "treeshake-options",
          files: fs.globSync(path.resolve(tmp.dir, "./resolver.mjs")),
          baseDir: tmp.dir,
          bundleTreeshake,
        })
      ).get("add")!;
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
