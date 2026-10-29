import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { createPlatformParser } from "./platform-parser";

describe("createPlatformParser", () => {
  test("names the parser file it cannot find", () => {
    const missing = path.join(import.meta.dirname, "missing.wasm");

    expect(() => createPlatformParser(missing)).toThrow(missing);
  });
});
