import { describe } from "vitest";
import { runRuleTests } from "./test-helpers.js";

const RULE = "no-plain-tailor-any-field-param";
const MESSAGE =
  "If the field passed to this parameter is used to build another field, such as with t.object(), its output type becomes any. Constrain a type parameter instead, such as <F extends TailorAnyField>(field: F). A helper that only reads the field is also reported, and the same rewrite is harmless.";
const IMPORT = 'import { t, type TailorAnyField } from "@tailor-platform/sdk";\n';

describe("rejects TailorAnyField in a parameter's type annotation", () => {
  runRuleTests(RULE, {
    invalid: [
      "function wrap(field: TailorAnyField) { return t.object({ value: field }); }",
      "function description(field: TailorAnyField) { return field.metadata.description; }",
      "function wrap(fields: Map<string, TailorAnyField>) {}",
      "async function wrap(field: Promise<TailorAnyField>) {}",
      "const wrap = (field: TailorAnyField) => t.object({ value: field });",
      "const wrap = function (field?: TailorAnyField) {};",
      "function paginated(item: Record<string, TailorAnyField>) {}",
      "function list(...fields: TailorAnyField[]) {}",
      "function list(fields: readonly TailorAnyField[]) {}",
      "function pair(fields: [name: string, field?: TailorAnyField]) {}",
      "function pair(fields: [string, TailorAnyField?]) {}",
      "function list(fields: [string, ...TailorAnyField[]]) {}",
      "function wrap<K extends string>(fields: { [P in K]: TailorAnyField }) {}",
      "function wrap(field: TailorAnyField | undefined) {}",
      "function wrap(field: TailorAnyField = t.string()) {}",
      "function wrap({ field }: { field: TailorAnyField }) {}",
      "function wrap(fields: { [name: string]: TailorAnyField }) {}",
      "function wrap(field: TailorAnyField & { extra?: true }) {}",
      "const helpers = { wrap(field: TailorAnyField) {} };",
      "class Builder { add(field: TailorAnyField) {} }",
      "class Builder { constructor(private field: TailorAnyField) {} }",
      "class Builder { constructor(readonly field: TailorAnyField = t.string()) {} }",
      "abstract class Builder { abstract add(field: TailorAnyField): void; }",
      "function wrap(field: TailorAnyField): void;\nfunction wrap(field: unknown) {}",
      "declare function wrap(field: TailorAnyField): void;",
    ].map((body) => ({ code: IMPORT + body, errors: [MESSAGE] })),
  });
});

describe("recognizes every import form of TailorAnyField", () => {
  runRuleTests(RULE, {
    invalid: [
      'import type { TailorAnyField } from "@tailor-platform/sdk";\nfunction wrap(field: TailorAnyField) {}',
      'import { type TailorAnyField as AnyField } from "@tailor-platform/sdk";\nfunction wrap(field: AnyField) {}',
      'import * as sdk from "@tailor-platform/sdk";\nfunction wrap(field: sdk.TailorAnyField) {}',
      'import type * as sdk from "@tailor-platform/sdk";\nfunction wrap(field: sdk.TailorAnyField) {}',
    ].map((code) => ({ code, errors: [MESSAGE] })),
  });
});

describe("accepts TailorAnyField outside a parameter's own type", () => {
  runRuleTests(RULE, {
    valid: [
      "function wrap<F extends TailorAnyField>(field: F) { return t.object({ value: field }); }",
      "const paginated = <F extends Record<string, TailorAnyField>>(item: F) => item;",
      "function wrap<F extends TailorAnyField = TailorAnyField>(field: F) {}",
      "function each(fields: string[], cb: (field: TailorAnyField) => void) {}",
      "function each(cb: <F extends TailorAnyField>(field: F) => void) {}",
      "function make(build: () => TailorAnyField) {}",
      "function pick(key: keyof TailorAnyField) {}",
      'function describe(metadata: TailorAnyField["metadata"]) {}',
      "function check<F>(field: F extends TailorAnyField ? F : never) {}",
      "function wrap(field: unknown) { return field as TailorAnyField; }",
      "function wrap(): TailorAnyField { return t.string(); }",
      "const make = () => (): TailorAnyField => t.string();",
      "type Fields = Record<string, TailorAnyField>;",
      "interface Holder { field: TailorAnyField }",
      "const field: TailorAnyField = t.string();",
      "class Holder { field?: TailorAnyField; }",
    ].map((body) => IMPORT + body),
  });
});

describe("accepts parameters that callers never pass a field to by that type", () => {
  runRuleTests(RULE, {
    valid: [
      "interface Holder { add(field: TailorAnyField): void }",
      "declare const fields: Record<string, TailorAnyField>;\nObject.values(fields).map((field: TailorAnyField) => field.metadata);",
      "declare const Builder: new (build: unknown) => object;\nnew Builder(function (field: TailorAnyField) {});",
      "function wrap<F extends TailorAnyField>(field: F): F;\nfunction wrap(field: TailorAnyField) { return field; }",
      "export function wrap<F extends TailorAnyField>(field: F): F;\nexport function wrap(field: TailorAnyField) { return field; }",
      "class Builder { add<F extends TailorAnyField>(field: F): F; add(field: TailorAnyField) { return field; } }",
    ].map((body) => IMPORT + body),
  });
});

describe("ignores other bindings named TailorAnyField", () => {
  runRuleTests(RULE, {
    valid: [
      'import type { TailorAnyField } from "another-sdk";\nfunction wrap(field: TailorAnyField) {}',
      "type TailorAnyField = string;\nfunction wrap(field: TailorAnyField) {}",
      IMPORT + "function wrap<TailorAnyField>(field: TailorAnyField) {}",
      'import * as other from "another-sdk";\nfunction wrap(field: other.TailorAnyField) {}',
    ],
  });
});
