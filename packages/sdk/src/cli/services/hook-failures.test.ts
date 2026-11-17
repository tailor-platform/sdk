import { describe, expect, test } from "vitest";
import { CLIError } from "#/cli/shared/errors";
import { createHookFailures } from "./hook-failures";

const coded = (code: string) => CLIError({ code, message: code });

describe("createHookFailures", () => {
  test("capture keeps a CLIError and returns the fallback", async () => {
    const failures = createHookFailures();
    const error = coded("FIRST");

    const result = failures.capture(() => {
      throw error;
    }, null);

    expect(result).toBeNull();
    await expect(failures.run(async () => "built")).rejects.toBe(error);
  });

  test("capture rethrows an error that is not a CLIError", async () => {
    const failures = createHookFailures();
    const error = new TypeError("boom");

    expect(() =>
      failures.capture(() => {
        throw error;
      }, null),
    ).toThrow(error);
    await expect(failures.run(async () => "built")).resolves.toBe("built");
  });

  test("throws the first recorded failure", async () => {
    const failures = createHookFailures();
    const first = coded("FIRST");
    failures.record(first);
    failures.record(coded("SECOND"));

    await expect(failures.run(async () => "built")).rejects.toBe(first);
  });

  test("a rejecting build surfaces the recorded CLIError instead of the build error", async () => {
    const failures = createHookFailures();
    const error = coded("FIRST");

    await expect(
      failures.run(async () => {
        failures.record(error);
        throw new TypeError("build failed");
      }),
    ).rejects.toBe(error);
  });

  test("a rejecting build with nothing recorded rethrows the build error", async () => {
    const failures = createHookFailures();
    const buildError = new TypeError("build failed");

    await expect(
      failures.run(async () => {
        throw buildError;
      }),
    ).rejects.toBe(buildError);
  });
});
