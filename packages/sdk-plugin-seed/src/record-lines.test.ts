import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlReader, unwrap } from "lines-db";
import { describe, test, expect } from "vitest";
import { firstErrorLocation, jsonlRecordLines, physicalLineOfRecord } from "./record-lines";
import type { ValidationErrorDetail } from "lines-db";

describe("jsonlRecordLines", () => {
  test.each([
    ["no blank lines", '{"a":1}\n{"a":2}\n'],
    ["an interior blank line", '{"a":1}\n\n{"a":2}\n'],
    ["whitespace-only lines", '  \n{"a":1}\n \t \n{"a":2}\n\n\n'],
    ["leading blank lines", '\n\n{"a":1}\n{"a":2}\n'],
    ["CRLF endings and a blank line", '{"a":1}\r\n\r\n{"a":2}\r\n'],
    ["a byte order mark", '﻿{"a":1}\n{"a":2}\n'],
  ])("reads the records the validator reads from a file with %s", async (_label, content) => {
    const dir = mkdtempSync(join(tmpdir(), "seed-loc-"));
    try {
      const file = join(dir, "T.jsonl");
      writeFileSync(file, content);
      const validatorRows = unwrap(await JsonlReader.read(file));
      expect(validatorRows).toEqual([{ a: 1 }, { a: 2 }]);

      const records = jsonlRecordLines(content);
      expect(records.map(({ text }) => JSON.parse(text))).toEqual(validatorRows);
      const lines = content.split("\n");
      for (const { text, line } of records) {
        expect(lines[line - 1]).toContain(text);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("drops a leading byte order mark and each line's trailing carriage return", () => {
    expect(jsonlRecordLines('\uFEFF{"a":1}\r\n\r\n{"a":2}\r\n')).toEqual([
      { text: '{"a":1}', line: 1 },
      { text: '{"a":2}', line: 3 },
    ]);
  });
});

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

  test("returns undefined for an empty file", () => {
    expect(physicalLineOfRecord("", 0)).toBeUndefined();
    expect(physicalLineOfRecord("\n\n", 0)).toBeUndefined();
  });
});

describe("firstErrorLocation", () => {
  const detail = (file: string, rowIndex: number): ValidationErrorDetail => ({
    file,
    rowIndex,
    tableName: "T",
    issues: [],
  });

  test("returns undefined when nothing failed", async () => {
    await expect(firstErrorLocation([])).resolves.toBeUndefined();
  });

  test("points at the first error's physical line, counting blank lines", async () => {
    const dir = mkdtempSync(join(tmpdir(), "seed-loc-"));
    try {
      const file = join(dir, "T.jsonl");
      // record 1 sits on physical line 3, because line 2 is blank
      writeFileSync(file, '{"a":1}\n\n{"a":2}\n');
      await expect(firstErrorLocation([detail(file, 1)])).resolves.toEqual({ file, line: 3 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports the first error's own file, not a later one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "seed-loc-"));
    try {
      const first = join(dir, "A.jsonl");
      const second = join(dir, "B.jsonl");
      writeFileSync(first, '{"a":1}\n');
      writeFileSync(second, '{"b":1}\n');
      await expect(firstErrorLocation([detail(first, 0), detail(second, 0)])).resolves.toEqual({
        file: first,
        line: 1,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("keeps the file and drops the line when it cannot be read", async () => {
    const missing = join(tmpdir(), "seed-loc-missing", "gone.jsonl");
    await expect(firstErrorLocation([detail(missing, 0)])).resolves.toEqual({ file: missing });
  });

  test("keeps the file and drops the line when the record index is past the end", async () => {
    const dir = mkdtempSync(join(tmpdir(), "seed-loc-"));
    try {
      const file = join(dir, "T.jsonl");
      writeFileSync(file, '{"a":1}\n');
      await expect(firstErrorLocation([detail(file, 9)])).resolves.toEqual({
        file,
        line: undefined,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
