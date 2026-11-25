import { describe, expect, test } from "vitest";
import { lintWithLocalRule } from "./test-helpers/local-rule";

const fixture = [
  "interface Named { a: string }",
  "export function declared(p: { a: string }) { return p; }",
  "export const assigned = (p: { a: string }) => p;",
  "export const expressed = function (p: { a: string }) { return p; };",
  "export const methods = { method(p: { a: string }) { return p; } };",
  "export class C { method(p: { a: string }) { return p; } constructor(p: { a: string }) { void p; } }",
  "export function optional(p?: { a: string }) { return p; }",
  "export function defaulted(p: { a?: string } = {}) { return p; }",
  "export function nullable(p: { a: string } | undefined | null) { return p; }",
  "/**",
  " * @param p - Partly documented",
  " * @param p.a - A",
  " */",
  "export function partly(p: { a: string; b: string }) { return p; }",
  "/**",
  " * @param q - Other",
  " * @param q.a - Another param's property",
  " * @param p - Bare property names",
  " * @param a - Not p.a",
  " */",
  "export function misattributed(q: { a: string }, p: { a: string }) { return [q, p]; }",
  "export function named(p: Named) { return p; }",
  "export const mapped = [1].map((p: { a: string }) => p);",
  'export const promised = new Promise((resolve: (value: { a: string }) => void) => resolve({ a: "x" }));',
  "register({ body: (p: { a: string }) => p });",
  "/**",
  " * @param p - Fully documented",
  " * @param {string} p.a - A",
  " * @param [p.b] - B",
  " */",
  "export function documented(p: { a: string; b?: string }) { return p; }",
  "export function arrayOf(p: { a: string }[]) { return p; }",
  "export function union(p: { a: string } | Named) { return p; }",
  "export type Fn = (p: { a: string }) => void;",
  "export interface Methods { method(p: { a: string }): void }",
  "export declare function overloaded(p: { a: string }): void;",
  "declare function register(definition: unknown): void;",
  "",
].join("\n");

function lint(level: "error" | "off") {
  return lintWithLocalRule({
    rule: "require-named-param-type",
    level,
    fileName: "module.ts",
    source: fixture,
  });
}

describe("local/require-named-param-type", () => {
  test("flags an inline object parameter type unless JSDoc documents each property", () => {
    expect(lint("error")).toEqual(
      [2, 3, 4, 5, 6, 6, 7, 8, 9, 14, 21].map((line) => ({
        rule: "local(require-named-param-type)",
        line,
      })),
    );
  });

  test("reports nothing when disabled, so the fixture itself is clean", () => {
    expect(lint("off")).toEqual([]);
  });
});
