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
  "export const held = new Holder((p: { a: string }) => p);",
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
  "declare class Holder { constructor(fn: unknown) }",
  "export function destructured({ a }: { a: string }) { return a; }",
  "/**",
  " * @param p - Indexed",
  " * @param p.key - Not a property name",
  " */",
  "export function indexed(p: { [key: string]: string }) { return p; }",
  "/**",
  " * @param p - Quoted",
  " * @param p.a - A",
  " */",
  'export function quoted(p: { "a": string }) { return p; }',
  'export const key = "a";',
  "/**",
  " * @param p - Computed",
  " * @param p.key - Not the computed key",
  " */",
  "export function computed(p: { [key]: string }) { return p; }",
  "export function namedOrUndefined(p: Named | undefined) { return p; }",
  'export const immediate = ((p: { a: string }) => p)({ a: "x" });',
  "/**",
  " * @param p - Documented arrow",
  " * @param p.a - A",
  " */",
  "export const documentedArrow = (p: { a: string }) => p;",
  "export class D { constructor(private readonly p: { a: string }) { void this.p; } }",
  "export class E { handle = (p: { a: string }) => p; }",
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
      [2, 3, 4, 5, 6, 6, 7, 8, 9, 14, 21, 44, 55, 57, 63, 64].map((line) => ({
        rule: "local(require-named-param-type)",
        line,
      })),
    );
  });

  test("reports nothing when disabled, so the fixture itself is clean", () => {
    expect(lint("off")).toEqual([]);
  });
});
