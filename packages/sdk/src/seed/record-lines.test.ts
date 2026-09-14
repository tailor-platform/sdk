import { describe, test, expect } from "vitest";
import { physicalLineOfRecord } from "./record-lines";

describe("physicalLineOfRecord", () => {
  test("maps records to their own lines when the file has no blank lines", () => {
    const content = '{"a":1}\n{"a":2}\n{"a":3}\n';
    expect(physicalLineOfRecord(content, 0)).toBe(1);
    expect(physicalLineOfRecord(content, 1)).toBe(2);
    expect(physicalLineOfRecord(content, 2)).toBe(3);
  });

  test("skips a blank line so a record keeps its physical line", () => {
    // record 2 sits on physical line 4, not line 3
    const content = '{"a":1}\n\n{"a":2}\n{"a":3}\n';
    expect(physicalLineOfRecord(content, 0)).toBe(1);
    expect(physicalLineOfRecord(content, 1)).toBe(3);
    expect(physicalLineOfRecord(content, 2)).toBe(4);
  });

  test("skips whitespace-only lines, which the reader also drops", () => {
    const content = '{"a":1}\n   \n\t\n{"a":2}\n';
    expect(physicalLineOfRecord(content, 1)).toBe(4);
  });

  test("skips leading blank lines", () => {
    const content = '\n\n{"a":1}\n';
    expect(physicalLineOfRecord(content, 0)).toBe(3);
  });

  test("handles CRLF line endings", () => {
    const content = '{"a":1}\r\n\r\n{"a":2}\r\n';
    expect(physicalLineOfRecord(content, 1)).toBe(3);
  });

  test("returns undefined for a record index past the end", () => {
    expect(physicalLineOfRecord('{"a":1}\n', 5)).toBeUndefined();
  });

  // The reader's own rule, mirrored from @toiroakr/lines-db: records are the
  // non-blank lines of a trimmed file. A divergence here means reported
  // locations point at the wrong line.
  const readerRecords = (content: string): string[] =>
    content
      .trim()
      .split("\n")
      .filter((line) => line.trim().length > 0);

  test.each([
    ['{"a":1}\n{"a":2}\n', "no blank lines"],
    ['{"a":1}\n\n{"a":2}\n', "an interior blank line"],
    ['\n\n{"a":1}\n{"a":2}\n', "leading blank lines"],
    ['{"a":1}\r\n\r\n{"a":2}\r\n', "CRLF endings"],
    ['  \n{"a":1}\n \t \n{"a":2}\n\n\n', "whitespace-only lines"],
  ])("points at the line holding each record with %s", (content) => {
    const records = readerRecords(content);
    expect(records.length).toBeGreaterThan(0);
    const lines = content.split("\n");
    for (const [index, record] of records.entries()) {
      const line = physicalLineOfRecord(content, index);
      expect(line).toBeDefined();
      expect(lines[(line ?? 0) - 1]?.trim()).toBe(record.trim());
    }
  });

  test("returns undefined for an empty file", () => {
    expect(physicalLineOfRecord("", 0)).toBeUndefined();
    expect(physicalLineOfRecord("\n\n", 0)).toBeUndefined();
  });
});
