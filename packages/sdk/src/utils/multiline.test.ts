import { describe, expect, test } from "vitest";
import multiline from "./multiline";

describe("multiline", () => {
  test("strips the common leading indent and trims surrounding blank lines", () => {
    const result = multiline`
      first
      second
      third
    `;
    expect(result).toBe(`first
second
third`);
  });

  test("preserves relative indentation between lines", () => {
    const result = multiline`
      outer
        inner
      outer
    `;
    expect(result).toBe(`outer
  inner
outer`);
  });

  test("indents multi-line interpolations to the placeholder's indent", () => {
    const inner = `a
b
c`;
    const result = multiline`
      header
        ${inner}
      footer
    `;
    expect(result).toBe(`header
  a
  b
  c
footer`);
  });

  test("returns single-line strings unchanged", () => {
    expect(multiline`hello`).toBe(`hello`);
  });

  test("accepts a plain string argument", () => {
    expect(
      multiline(`
  one
  two
`),
    ).toBe(`one
two`);
  });

  test("preserves blank lines inside the block", () => {
    const result = multiline`
      one

      two
    `;
    expect(result).toBe(`one

two`);
  });
});
