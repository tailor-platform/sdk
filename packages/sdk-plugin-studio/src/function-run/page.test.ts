import { describe, expect, test } from "vitest";
import { injectToken } from "./page";

describe("injectToken", () => {
  test("puts the token in a meta tag at the start of the head", () => {
    expect(injectToken("<html><head><title>t</title></head></html>", "tok-123")).toBe(
      '<html><head><meta name="tailor-studio-token" content="tok-123"><title>t</title></head></html>',
    );
  });

  test("escapes characters that would end the attribute", () => {
    expect(injectToken("<head></head>", '"><script>')).toBe(
      '<head><meta name="tailor-studio-token" content="&quot;&gt;&lt;script&gt;"></head>',
    );
  });

  test("fails when the page has no head to put the token in", () => {
    expect(() => injectToken("<html></html>", "tok")).toThrow("no <head>");
  });
});
