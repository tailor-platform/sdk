import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { hashContent, hashFile, hashFiles } from "./hasher";

describe("hasher", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hasher-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("hashContent", () => {
    test("returns consistent SHA-256 hex string", () => {
      const hash = hashContent("hello");
      const expected = crypto.createHash("sha256").update("hello", "utf-8").digest("hex");
      expect(hash).toBe(expected);
      // Verify it's a 64-char hex string (SHA-256)
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    test("returns different hashes for different inputs", () => {
      const hash1 = hashContent("hello");
      const hash2 = hashContent("world");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("hashFile", () => {
    test("reads a file and returns its hash", () => {
      const filePath = path.join(tmpDir, "test.txt");
      fs.writeFileSync(filePath, "file content");

      const hash = hashFile(filePath);
      const expected = crypto.createHash("sha256").update("file content", "utf-8").digest("hex");
      expect(hash).toBe(expected);
    });
  });

  describe("hashFiles", () => {
    test("returns deterministic hash regardless of input order", () => {
      const fileA = path.join(tmpDir, "a.txt");
      const fileB = path.join(tmpDir, "b.txt");
      fs.writeFileSync(fileA, "content a");
      fs.writeFileSync(fileB, "content b");

      const hash1 = hashFiles([fileA, fileB]);
      const hash2 = hashFiles([fileB, fileA]);
      expect(hash1).toBe(hash2);
    });

    test("returns consistent hash for empty array", () => {
      const hash = hashFiles([]);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hashFiles([])).toBe(hash);
    });

    test("returns different hash when file content changes", () => {
      const fileA = path.join(tmpDir, "a.txt");
      const fileB = path.join(tmpDir, "b.txt");
      fs.writeFileSync(fileA, "content a");
      fs.writeFileSync(fileB, "content b");

      const hashBefore = hashFiles([fileA, fileB]);

      fs.writeFileSync(fileA, "modified content a");

      const hashAfter = hashFiles([fileA, fileB]);
      expect(hashBefore).not.toBe(hashAfter);
    });
  });
});
