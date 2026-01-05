import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatTable,
  formatKeyValueTable,
  formatTableWithHeaders,
  formatValue,
  humanizeRelativeTime,
  printData,
} from "./format";

describe("format", () => {
  describe("formatTable", () => {
    test("formats a simple table with norc border", () => {
      const result = formatTable([
        ["a", "b"],
        ["c", "d"],
      ]);
      expect(result).toContain("┌");
      expect(result).toContain("└");
      expect(result).toContain("│");
      expect(result).toContain("a");
      expect(result).toContain("d");
      // Should NOT contain double-line borders
      expect(result).not.toContain("╔");
      expect(result).not.toContain("║");
    });

    test("applies custom config while keeping norc border", () => {
      const result = formatTable(
        [
          ["key", "value"],
          ["foo", "bar"],
        ],
        { singleLine: true },
      );
      expect(result).toContain("┌");
      expect(result).toContain("key");
      expect(result).toContain("bar");
    });
  });

  describe("formatKeyValueTable", () => {
    test("formats key-value pairs without horizontal lines between rows", () => {
      const result = formatKeyValueTable([
        ["name", "test"],
        ["status", "ok"],
      ]);
      expect(result).toContain("name");
      expect(result).toContain("test");
      expect(result).toContain("status");
      expect(result).toContain("ok");
      // singleLine mode - check structure
      const lines = result.trim().split("\n");
      expect(lines[0]).toContain("┌");
      expect(lines[lines.length - 1]).toContain("└");
    });
  });

  describe("formatTableWithHeaders", () => {
    test("formats table with header separator", () => {
      const result = formatTableWithHeaders(
        ["col1", "col2"],
        [
          ["a", "b"],
          ["c", "d"],
        ],
      );
      expect(result).toContain("col1");
      expect(result).toContain("col2");
      expect(result).toContain("a");
      expect(result).toContain("d");
      // Should have header separator line
      expect(result).toContain("├");
      expect(result).toContain("┼");
    });

    test("handles empty rows", () => {
      const result = formatTableWithHeaders(["col1", "col2"], []);
      expect(result).toContain("col1");
      expect(result).toContain("col2");
    });
  });

  describe("formatValue", () => {
    test("returns empty string for null", () => {
      expect(formatValue(null)).toBe("");
    });

    test("returns empty string for undefined", () => {
      expect(formatValue(undefined)).toBe("");
    });

    test("converts string as-is", () => {
      expect(formatValue("hello")).toBe("hello");
    });

    test("converts number to string", () => {
      expect(formatValue(42)).toBe("42");
      expect(formatValue(3.14)).toBe("3.14");
    });

    test("converts boolean to string", () => {
      expect(formatValue(true)).toBe("true");
      expect(formatValue(false)).toBe("false");
    });

    test("formats array with newline-separated values", () => {
      expect(formatValue(["a", "b", "c"])).toBe("a\nb\nc");
    });

    test("formats array of numbers", () => {
      expect(formatValue([1, 2, 3])).toBe("1\n2\n3");
    });

    test("formats empty array", () => {
      expect(formatValue([])).toBe("");
    });

    test("formats object as indented JSON", () => {
      const result = formatValue({ foo: "bar", num: 42 });
      expect(result).toBe('{\n  "foo": "bar",\n  "num": 42\n}');
    });

    test("formats nested object", () => {
      const result = formatValue({ outer: { inner: "value" } });
      expect(result).toContain('"outer"');
      expect(result).toContain('"inner"');
      expect(result).toContain('"value"');
    });

    test("formats empty object", () => {
      expect(formatValue({})).toBe("{}");
    });
  });

  describe("humanizeRelativeTime", () => {
    test("returns original string for invalid date", () => {
      expect(humanizeRelativeTime("not-a-date")).toBe("not-a-date");
      expect(humanizeRelativeTime("")).toBe("");
    });

    test("formats valid ISO date as relative time", () => {
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
      const result = humanizeRelativeTime(fiveMinutesAgo);
      expect(result).toContain("ago");
      expect(result).toContain("5");
      expect(result).toContain("minute");
    });

    test("formats date in the past", () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const result = humanizeRelativeTime(twoDaysAgo);
      expect(result).toContain("ago");
    });
  });

  describe("printData", () => {
    let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      stdoutWriteSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    test("outputs JSON when json flag is true", () => {
      const data = { name: "test", value: 42 };
      printData(data, true);
      expect(consoleLogSpy).toHaveBeenCalledWith(JSON.stringify(data));
      expect(stdoutWriteSpy).not.toHaveBeenCalled();
    });

    test("outputs key-value table for single object", () => {
      const data = { name: "test", status: "ok" };
      printData(data);
      expect(stdoutWriteSpy).toHaveBeenCalled();
      const output = stdoutWriteSpy.mock.calls[0][0] as string;
      expect(output).toContain("name");
      expect(output).toContain("test");
      expect(output).toContain("status");
      expect(output).toContain("ok");
    });

    test("outputs nothing for empty array", () => {
      printData([]);
      expect(stdoutWriteSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    test("outputs table with headers for array of objects", () => {
      const data = [
        { name: "item1", value: "a" },
        { name: "item2", value: "b" },
      ];
      printData(data);
      expect(stdoutWriteSpy).toHaveBeenCalled();
      const output = stdoutWriteSpy.mock.calls[0][0] as string;
      expect(output).toContain("name");
      expect(output).toContain("value");
      expect(output).toContain("item1");
      expect(output).toContain("item2");
      // Should have header separator
      expect(output).toContain("├");
    });

    test("formats nested object in value", () => {
      const data = { config: { nested: "value" } };
      printData(data);
      const output = stdoutWriteSpy.mock.calls[0][0] as string;
      expect(output).toContain("config");
      expect(output).toContain('"nested"');
      expect(output).toContain('"value"');
    });

    test("formats array in value", () => {
      const data = { tags: ["a", "b", "c"] };
      printData(data);
      const output = stdoutWriteSpy.mock.calls[0][0] as string;
      expect(output).toContain("tags");
      expect(output).toContain("a");
      expect(output).toContain("b");
      expect(output).toContain("c");
    });

    test("handles objects with different keys in array", () => {
      const data = [{ name: "a" }, { name: "b", extra: "c" }];
      printData(data);
      const output = stdoutWriteSpy.mock.calls[0][0] as string;
      expect(output).toContain("name");
      expect(output).toContain("extra");
      expect(output).toContain("a");
      expect(output).toContain("b");
      expect(output).toContain("c");
    });

    test("humanizes createdAt field in array", () => {
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
      const data = [{ name: "test", createdAt: fiveMinutesAgo }];
      printData(data);
      const output = stdoutWriteSpy.mock.calls[0][0] as string;
      expect(output).toContain("5 minutes ago");
    });

    test("humanizes updatedAt field in array", () => {
      const now = new Date();
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
      const data = [{ name: "test", updatedAt: tenMinutesAgo }];
      printData(data);
      const output = stdoutWriteSpy.mock.calls[0][0] as string;
      expect(output).toContain("10 minutes ago");
    });
  });
});
