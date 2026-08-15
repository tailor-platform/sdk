import { defineCommand, runCommand } from "@politty/valibot";
import * as v from "valibot";
import { afterEach, describe, expect, test } from "vitest";
import { commonArgs } from "./args";
import { logger } from "./logger";

const command = defineCommand({
  name: "noop",
  run: () => {},
});

afterEach(() => {
  logger.verbose = false;
  logger.jsonMode = false;
});

describe("commonArgs", () => {
  test("--verbose enables verbose logging", async () => {
    const result = await runCommand(command, ["--verbose"], {
      globalArgs: v.object(commonArgs()),
    });

    expect(result.exitCode).toBe(0);
    expect(logger.verbose).toBe(true);
  });

  test("-v does not enable verbose logging without an alias", async () => {
    const result = await runCommand(command, ["-v"], {
      globalArgs: v.object(commonArgs()),
    });

    expect(result.exitCode).toBe(0);
    expect(logger.verbose).toBe(false);
  });

  test("verboseAlias adds a short alias for --verbose", async () => {
    const result = await runCommand(command, ["-v"], {
      globalArgs: v.object(commonArgs({ verboseAlias: "v" })),
    });

    expect(result.exitCode).toBe(0);
    expect(logger.verbose).toBe(true);
  });
});
