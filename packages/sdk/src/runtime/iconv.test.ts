/**
 * Tests for `@tailor-platform/sdk/runtime/iconv` typed wrappers.
 *
 * Verifies that each wrapper forwards to `globalThis.tailor.iconv.*` (recorded
 * via `iconvMock().calls`) and that the return-type narrowing (`UTF-8` →
 * `string`, otherwise `Uint8Array`) holds at the type level.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, test } from "vitest";
import * as iconv from "@/runtime/iconv";
import { cleanupMocks, iconvMock, injectMocks } from "@/vitest/mock";

describe("@tailor-platform/sdk/runtime/iconv", () => {
  beforeEach(() => {
    injectMocks(globalThis);
  });

  afterEach(() => {
    cleanupMocks(globalThis);
  });

  test("convert forwards args and returns string for UTF-8 target", () => {
    using iconvM = iconvMock();
    iconvM.setResolver((method, args) => {
      if (method === "convert" && args[2] === "UTF-8") return "decoded";
      return undefined;
    });

    const out = iconv.convert(new Uint8Array([0x61]), "Shift_JIS", "UTF-8");

    expect(out).toBe("decoded");
    expectTypeOf(out).toEqualTypeOf<string>();
    expect(iconvM.calls).toEqual([
      { method: "convert", args: [new Uint8Array([0x61]), "Shift_JIS", "UTF-8"] },
    ]);
  });

  test("convert returns Uint8Array for non-UTF-8 target", () => {
    using iconvM = iconvMock();
    iconvM.setResolver(() => new Uint8Array([0x82, 0xa0]));

    const out = iconv.convert("あ", "UTF-8", "Shift_JIS");

    expect(out).toBeInstanceOf(Uint8Array);
    expectTypeOf(out).toEqualTypeOf<Uint8Array>();
  });

  test("convertBuffer forwards and narrows return type", () => {
    using iconvM = iconvMock();
    iconvM.setResolver(() => "ok");

    const out = iconv.convertBuffer(new Uint8Array(), "Shift_JIS", "UTF-8");

    expect(out).toBe("ok");
    expectTypeOf(out).toEqualTypeOf<string>();
    expect(iconvM.calls[0]).toMatchObject({ method: "convertBuffer" });
  });

  test("decode forwards args and returns string", () => {
    using iconvM = iconvMock();
    iconvM.setResolver(() => "hello");

    const out = iconv.decode(new Uint8Array([0x68]), "ASCII");

    expect(out).toBe("hello");
    expectTypeOf(out).toEqualTypeOf<string>();
    expect(iconvM.calls[0]).toMatchObject({
      method: "decode",
      args: [new Uint8Array([0x68]), "ASCII"],
    });
  });

  test("encode narrows return type by encoding", () => {
    using iconvM = iconvMock();
    iconvM.setResolver((_method, args) => (args[1] === "UTF-8" ? "x" : new Uint8Array([1])));

    const utf8 = iconv.encode("a", "UTF-8");
    const sjis = iconv.encode("a", "Shift_JIS");

    expectTypeOf(utf8).toEqualTypeOf<string>();
    expectTypeOf(sjis).toEqualTypeOf<Uint8Array>();
    expect(utf8).toBe("x");
    expect(sjis).toBeInstanceOf(Uint8Array);
  });

  test("encodings forwards and returns string[]", () => {
    using iconvM = iconvMock();
    iconvM.setResolver(() => ["UTF-8", "Shift_JIS"]);

    const list = iconv.encodings();

    expect(list).toEqual(["UTF-8", "Shift_JIS"]);
    expectTypeOf(list).toEqualTypeOf<string[]>();
  });

  test("Iconv class delegates convert to global Iconv", () => {
    using iconvM = iconvMock();
    iconvM.setResolver((method) => (method === "convert" ? "via-class" : undefined));

    const conv = new iconv.Iconv("Shift_JIS", "UTF-8");
    const out = conv.convert(new Uint8Array([0x61]));

    expect(out).toBe("via-class");
    expect(iconvM.calls).toEqual([
      {
        method: "convert",
        args: [new Uint8Array([0x61]), "Shift_JIS", "UTF-8"],
      },
    ]);
  });
});
