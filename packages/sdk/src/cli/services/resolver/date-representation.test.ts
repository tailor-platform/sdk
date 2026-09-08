import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { bundleForRun } from "#/cli/commands/function/bundle";
import { detectFunctionType } from "#/cli/commands/function/detect";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
import { bundleResolvers } from "./bundler";

describe("resolver Date representation bundles", () => {
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

  test.each(["production", "function run"] as const)("converts dates through %s", async (mode) => {
    using tmp = tempCwd("sdk-date-representation-");
    const scopeDir = path.join(tmp.dir, "node_modules/@tailor-platform");
    fs.mkdirSync(scopeDir, { recursive: true });
    fs.symlinkSync(path.resolve(__dirname, "../../../.."), path.join(scopeDir, "sdk"), "dir");
    const sourceFile = path.join(tmp.dir, "resolver.mjs");
    fs.writeFileSync(
      sourceFile,
      `
      import { createResolver, t } from "@tailor-platform/sdk";
      const date = t.date({ as: "date" }).validate(({ value }) =>
        value instanceof Date ? undefined : "Expected Date in validator"
      );
      const fields = {
        rows: t.object({
          day: date,
          dates: t.date({ as: "date", array: true }),
          absent: t.date({ as: "date", optional: true }),
          plain: t.date(),
        }, { array: true }),
      };
      export default createResolver({
        name: "dateRoundTrip",
        operation: "query",
        input: { ...fields, invalidOutput: t.bool({ optional: true }) },
        body: async ({ input }) => {
          const row = input.rows[0];
          if (!(row.day instanceof Date) || row.day.getUTCHours() !== 0 ||
              !row.dates.every((day) => day instanceof Date)) {
            throw new Error("Expected UTC Date input in body");
          }
          if (input.invalidOutput) row.day = new Date(NaN);
          else row.day.setUTCDate(row.day.getUTCDate() + 1);
          return { rows: input.rows };
        },
        output: fields,
      });
    `,
    );
    const detected = await detectFunctionType({ filePath: sourceFile });
    expect(detected.type).toBe("resolver");
    const input = {
      rows: [
        {
          day: "2024-02-29",
          dates: ["0000-02-29", "0099-12-31"],
          absent: null,
          plain: "2026-09-07",
        },
      ],
    };
    expect(
      detected.inputSchema?.parse({ value: input, data: input, invoker: null }).issues,
    ).toBeUndefined();

    const code =
      mode === "production"
        ? (
            await bundleResolvers({
              namespace: "date",
              config: { files: ["./resolver.mjs"] },
              baseDir: tmp.dir,
              inlineSourcemap: true,
            })
          ).get("dateRoundTrip")!
        : (
            await bundleForRun({
              detected,
              sourceFile,
              baseDir: tmp.dir,
              machineUser: { name: "test", id: "test", attributes: null, attributeList: [] },
              workspaceId: "test",
            })
          ).bundledCode;
    const bundlePath = path.join(tmp.dir, "bundle.mjs");
    fs.writeFileSync(bundlePath, code);
    const { main } = await import(pathToFileURL(bundlePath).href);
    const run = (value: unknown) =>
      main(mode === "production" ? { input: value, caller: null, env: {} } : value);

    await expect(run(input)).resolves.toEqual({ rows: [{ ...input.rows[0], day: "2024-03-01" }] });
    expect(input.rows[0]?.day).toBe("2024-02-29");
    await expect(run({ rows: [{ ...input.rows[0], day: "2023-02-29" }] })).rejects.toThrow(
      "valid calendar date",
    );
    await expect(run({ ...input, invalidOutput: true })).rejects.toThrow(
      "Invalid date at rows[0].day",
    );
  });
});
