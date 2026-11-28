import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { bundleForRun } from "#/cli/commands/function/bundle";
import { detectFunctionType } from "#/cli/commands/function/detect";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
import { bundleResolvers } from "./bundler";

describe("resolver Decimal representation bundles", () => {
  aroundEach(async (runTest) => {
    vi.stubGlobal("tailor", { context: { getInvoker: () => null } });
    vi.stubGlobal(
      "TailorErrors",
      class extends Error {
        constructor(readonly issues: unknown[]) {
          super(JSON.stringify(issues));
        }
      },
    );
    try {
      await runTest();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // The resolver declares neither a decimal nor a date field, so the bundle leaves both
  // converters out of `.parse()` and only the helper it calls brings them back.
  async function runBody(parseCall: string): Promise<unknown> {
    using tmp = tempCwd("sdk-decimal-representation-");
    const scopeDir = path.join(tmp.dir, "node_modules/@tailor-platform");
    fs.mkdirSync(scopeDir, { recursive: true });
    fs.symlinkSync(path.resolve(__dirname, "../../../.."), path.join(scopeDir, "sdk"), "dir");
    fs.writeFileSync(
      path.join(tmp.dir, "resolver.mjs"),
      `
      import { createResolver, t } from "@tailor-platform/sdk";
      import { Decimal, parseDateFields, parseDecimalFields } from "@tailor-platform/sdk/runtime";
      const payload = t.object({
        price: t.decimal({ as: "decimal" }),
        due: t.date({ as: "date" }),
      });
      export default createResolver({
        name: "mixed",
        operation: "query",
        input: { raw: t.string() },
        body: async ({ input }) => {
          const result = ${parseCall};
          if (result.issues) throw new Error("issues");
          return Decimal.isDecimal(result.value.price) && result.value.due instanceof Date;
        },
        output: t.bool(),
      });
    `,
    );
    const code = (
      await bundleResolvers({
        namespace: "decimal",
        files: fs.globSync(path.resolve(tmp.dir, "./resolver.mjs")),
        baseDir: tmp.dir,
      })
    ).get("mixed")!;
    const bundlePath = path.join(tmp.dir, "bundle.mjs");
    fs.writeFileSync(bundlePath, code);
    const { main } = await import(pathToFileURL(bundlePath).href);
    return main({
      input: { raw: JSON.stringify({ price: "1.5", due: "2026-01-02" }) },
      caller: null,
      env: {},
    });
  }

  const args = "{ value: JSON.parse(input.raw), data: undefined, invoker: null }";

  test("parseDecimalFields converts decimal and date fields of one schema", async () => {
    await expect(runBody(`parseDecimalFields(payload, ${args})`)).resolves.toBe(true);
  });

  test(".parse() points to parseDecimalFields for a decimal field the bundle leaves out", async () => {
    await expect(runBody(`payload.parse(${args})`)).rejects.toThrow(
      'Parsing fields declared with as: "decimal" is not included in this bundle. Parse them with parseDecimalFields, exported by "@tailor-platform/sdk/runtime".',
    );
  });

  test("parseDateFields points to parseDecimalFields instead of leaving a decimal a string", async () => {
    await expect(runBody(`parseDateFields(payload, ${args})`)).rejects.toThrow(
      'Parsing fields declared with as: "decimal" needs parseDecimalFields, exported by "@tailor-platform/sdk/runtime".',
    );
  });

  test("a decimal field that omits as is parsed to Decimal when the config sets defaultDecimalRepresentation", async () => {
    using tmp = tempCwd("sdk-decimal-default-");
    const scopeDir = path.join(tmp.dir, "node_modules/@tailor-platform");
    fs.mkdirSync(scopeDir, { recursive: true });
    fs.symlinkSync(path.resolve(__dirname, "../../../.."), path.join(scopeDir, "sdk"), "dir");
    fs.writeFileSync(
      path.join(tmp.dir, "resolver.mjs"),
      `
      import { createResolver, t } from "@tailor-platform/sdk";
      import { Decimal } from "@tailor-platform/sdk/runtime";
      const payload = t.object({ price: t.decimal(), label: t.decimal({ as: "string" }) });
      export default createResolver({
        name: "defaulted",
        operation: "query",
        input: { raw: t.string() },
        body: async ({ input }) => {
          const result = payload.parse({ value: JSON.parse(input.raw), data: undefined, invoker: null });
          if (result.issues) throw new Error("issues");
          return Decimal.isDecimal(result.value.price) && typeof result.value.label === "string";
        },
        output: t.bool(),
      });
    `,
    );
    const code = (
      await bundleResolvers({
        namespace: "decimal",
        files: fs.globSync(path.resolve(tmp.dir, "./resolver.mjs")),
        baseDir: tmp.dir,
        decimalDefault: "decimal",
      })
    ).get("defaulted")!;
    const bundlePath = path.join(tmp.dir, "bundle.mjs");
    fs.writeFileSync(bundlePath, code);
    const { main } = await import(pathToFileURL(bundlePath).href);

    await expect(
      main({
        input: { raw: JSON.stringify({ price: "1.5", label: "2.50" }) },
        caller: null,
        env: {},
      }),
    ).resolves.toBe(true);
  });

  test.each(["production", "function run"] as const)(
    "converts decimal fields that omit as through %s when the config sets defaultDecimalRepresentation",
    async (mode) => {
      using tmp = tempCwd("sdk-decimal-default-round-trip-");
      const scopeDir = path.join(tmp.dir, "node_modules/@tailor-platform");
      fs.mkdirSync(scopeDir, { recursive: true });
      fs.symlinkSync(path.resolve(__dirname, "../../../.."), path.join(scopeDir, "sdk"), "dir");
      const sourceFile = path.join(tmp.dir, "resolver.mjs");
      fs.writeFileSync(
        sourceFile,
        `
        import { createResolver, t } from "@tailor-platform/sdk";
        import { Decimal } from "@tailor-platform/sdk/runtime";
        const fields = {
          rows: t.object({
            price: t.decimal(),
            tiers: t.decimal({ array: true }),
            label: t.decimal({ as: "string" }),
          }, { array: true }),
        };
        export default createResolver({
          name: "decimalRoundTrip",
          operation: "query",
          input: fields,
          body: async ({ input }) => {
            const row = input.rows[0];
            if (!Decimal.isDecimal(row.price) || !row.tiers.every((tier) => Decimal.isDecimal(tier)) ||
                typeof row.label !== "string") {
              throw new Error("Expected Decimal input in body");
            }
            return {
              rows: [{
                price: row.price.plus(1),
                tiers: row.tiers.map((tier) => tier.plus(1)),
                label: row.label,
              }],
            };
          },
          output: fields,
        });
      `,
      );
      const detected = await detectFunctionType({ filePath: sourceFile });
      expect(detected.type).toBe("resolver");

      const code =
        mode === "production"
          ? (
              await bundleResolvers({
                namespace: "decimal",
                files: fs.globSync(path.resolve(tmp.dir, "./resolver.mjs")),
                baseDir: tmp.dir,
                decimalDefault: "decimal",
              })
            ).get("decimalRoundTrip")!
          : (
              await bundleForRun({
                detected,
                sourceFile,
                baseDir: tmp.dir,
                machineUser: { name: "test", id: "test", attributes: null, attributeList: [] },
                workspaceId: "test",
                decimalDefault: "decimal",
              })
            ).bundledCode;
      const bundlePath = path.join(tmp.dir, "bundle.mjs");
      fs.writeFileSync(bundlePath, code);
      const { main } = await import(pathToFileURL(bundlePath).href);
      const input = { rows: [{ price: "1.5", tiers: ["2.25", "3"], label: "2.50" }] };

      await expect(
        main(mode === "production" ? { input, caller: null, env: {} } : input),
      ).resolves.toEqual({ rows: [{ price: "2.5", tiers: ["3.25", "4"], label: "2.50" }] });
    },
  );
});
