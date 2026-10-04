import { describe, expect, test, vi } from "vitest";
import { logger } from "./logger";
import { printMutationResult } from "./mutation-result";
import { jsonMode } from "./test-helpers/json-mode";

describe("printMutationResult", () => {
  test("prints the result on stdout under JSON output", () => {
    using _json = jsonMode();
    using out = vi.spyOn(logger, "out").mockImplementation(() => {});

    printMutationResult({ changed: true, name: "dev" });

    expect(out).toHaveBeenCalledWith({ changed: true, name: "dev" });
  });

  test("writes nothing to stdout without JSON output", () => {
    using _json = jsonMode(false);
    using write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    using log = vi.spyOn(console, "log").mockImplementation(() => {});

    printMutationResult({ changed: true, name: "dev" });

    expect(write).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
