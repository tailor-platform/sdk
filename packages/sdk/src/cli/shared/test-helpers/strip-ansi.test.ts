import { describe, expect, test } from "vitest";
import { stripAnsi } from "./strip-ansi";

describe("stripAnsi", () => {
  test("strips SGR and private-mode CSI sequences", () => {
    expect(stripAnsi("\x1b[32m✓ done\x1b[0m")).toBe("✓ done");
    expect(stripAnsi("\x1b[?25l\x1b[2Kworking\x1b[?25h")).toBe("working");
  });

  test("keeps bracket text that is not preceded by ESC", () => {
    expect(stripAnsi("literal [0m stays [2K intact")).toBe("literal [0m stays [2K intact");
  });
});
