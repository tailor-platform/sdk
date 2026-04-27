import { afterEach, describe, it, expect, expectTypeOf } from "vitest";
import { setupIconvMock } from "@/utils/test/mock";
import { convert, convertBuffer, decode, encode, encodings, Iconv } from "./index";

const TailorGlobal = globalThis as { tailor?: { iconv?: unknown } };

describe("@tailor-platform/sdk/iconv", () => {
  afterEach(() => {
    delete TailorGlobal.tailor;
  });

  describe("convert", () => {
    it("delegates to tailor.iconv.convert", () => {
      const { calls } = setupIconvMock();
      const result = convert("hello", "UTF-8", "Shift_JIS");
      expect(result).toBeInstanceOf(Uint8Array);
      expect(calls).toEqual([{ method: "convert", args: ["hello", "UTF-8", "Shift_JIS"] }]);
    });

    it("returns string when toEncoding is UTF-8", () => {
      setupIconvMock({
        onConvert: (input, _from, to) => {
          if (to === "UTF-8") return "decoded";
          return new Uint8Array([1, 2, 3]);
        },
      });
      const result = convert(new Uint8Array([0xe3, 0x81, 0x82]), "Shift_JIS", "UTF-8");
      expect(result).toBe("decoded");
    });

    it("type narrows return based on toEncoding literal", () => {
      setupIconvMock();
      // Type-level checks — only reachable when iconv mock is set up at runtime.
      expectTypeOf(convert("a", "UTF-8", "UTF-8")).toEqualTypeOf<string>();
      expectTypeOf(convert("a", "UTF-8", "UTF8")).toEqualTypeOf<string>();
      expectTypeOf(convert("a", "UTF-8", "Shift_JIS")).toEqualTypeOf<Uint8Array>();
    });
  });

  describe("convertBuffer", () => {
    it("delegates to tailor.iconv.convertBuffer", () => {
      const { calls } = setupIconvMock();
      const buf = new Uint8Array([1, 2, 3]);
      convertBuffer(buf, "Shift_JIS", "UTF-8");
      expect(calls).toEqual([{ method: "convertBuffer", args: [buf, "Shift_JIS", "UTF-8"] }]);
    });
  });

  describe("decode", () => {
    it("decodes a buffer to a UTF-8 string", () => {
      const { calls } = setupIconvMock();
      const buf = new TextEncoder().encode("hello");
      const result = decode(buf, "UTF-8");
      expect(result).toBe("hello");
      expect(calls).toEqual([{ method: "decode", args: [buf, "UTF-8"] }]);
    });
  });

  describe("encode", () => {
    it("encodes a string to a buffer", () => {
      const { calls } = setupIconvMock();
      const result = encode("hello", "Shift_JIS");
      expect(result).toBeInstanceOf(Uint8Array);
      expect(calls).toEqual([{ method: "encode", args: ["hello", "Shift_JIS"] }]);
    });

    it("returns string when encoding is UTF-8", () => {
      setupIconvMock();
      expectTypeOf(encode("a", "UTF-8")).toEqualTypeOf<string>();
      expectTypeOf(encode("a", "Shift_JIS")).toEqualTypeOf<Uint8Array>();
    });
  });

  describe("encodings", () => {
    it("returns the platform's supported encoding list", () => {
      const { calls } = setupIconvMock({ onEncodings: () => ["UTF-8", "FOO"] });
      expect(encodings()).toEqual(["UTF-8", "FOO"]);
      expect(calls).toEqual([{ method: "encodings", args: [] }]);
    });
  });

  describe("Iconv class", () => {
    it("constructs and converts via the platform Iconv class", () => {
      const { calls } = setupIconvMock();
      const conv = new Iconv("Shift_JIS", "UTF-8");
      const result = conv.convert(new Uint8Array([0xe3, 0x81, 0x82]));
      expect(typeof result).toBe("string");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe("convert");
    });

    it("reuses fixed encoding pair across calls", () => {
      const { calls } = setupIconvMock();
      const conv = new Iconv("UTF-8", "Shift_JIS");
      conv.convert("a");
      conv.convert("b");
      expect(calls).toHaveLength(2);
      expect(calls[0]?.args[1]).toBe("UTF-8");
      expect(calls[0]?.args[2]).toBe("Shift_JIS");
      expect(calls[1]?.args[1]).toBe("UTF-8");
    });
  });

  it("throws a clear runtime error when tailor.iconv is not available", () => {
    expect(() => convert("a", "UTF-8", "UTF-8")).toThrow();
  });
});
