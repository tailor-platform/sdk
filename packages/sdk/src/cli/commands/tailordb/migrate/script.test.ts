import { describe, expect, it } from "vitest";
import { parseMigrationNumber } from "./script";

describe("parseMigrationNumber", () => {
  describe("accepts canonical and integer forms", () => {
    it("parses the canonical 4-digit form", () => {
      expect(parseMigrationNumber("0001")).toBe(1);
      expect(parseMigrationNumber("0042")).toBe(42);
      expect(parseMigrationNumber("9999")).toBe(9999);
    });

    it("parses bare integer form", () => {
      expect(parseMigrationNumber("1")).toBe(1);
      expect(parseMigrationNumber("42")).toBe(42);
      expect(parseMigrationNumber("9999")).toBe(9999);
    });
  });

  describe("rejects invalid input", () => {
    it("rejects integer forms with leading zeros that are not the canonical 4 digits", () => {
      expect(() => parseMigrationNumber("00001")).toThrow(/Invalid migration number format/);
      expect(() => parseMigrationNumber("00")).toThrow(/Invalid migration number format/);
    });

    it("rejects non-digit input", () => {
      expect(() => parseMigrationNumber("abc")).toThrow(/Invalid migration number format/);
      expect(() => parseMigrationNumber("1a")).toThrow(/Invalid migration number format/);
      expect(() => parseMigrationNumber("")).toThrow(/Invalid migration number format/);
    });

    it("rejects integers above 9999", () => {
      expect(() => parseMigrationNumber("10000")).toThrow(/out of range/);
      expect(() => parseMigrationNumber("100000")).toThrow(/out of range/);
    });

    it("rejects the initial schema number (0)", () => {
      expect(() => parseMigrationNumber("0000")).toThrow(/initial schema snapshot/);
    });
  });
});
