import { RuleTester } from "oxlint/plugins-dev";
import { describe, test } from "vitest";
import plugin, { type TailorSdkRuleName } from "../index.js";

RuleTester.describe = describe;
RuleTester.it = test;

const ruleTester = new RuleTester({
  languageOptions: { sourceType: "module", parserOptions: { lang: "ts" } },
});

export function runRuleTests(name: TailorSdkRuleName, tests: Partial<RuleTester.TestCases>): void {
  ruleTester.run(name, plugin.rules[name] as unknown as Parameters<RuleTester["run"]>[1], {
    valid: [],
    invalid: [],
    ...tests,
  });
}

export interface ResolverFixture {
  prelude?: string;
  operation?: "query" | "mutation" | { source: string };
  input?: string;
  permission?: string;
  body?: string;
}

/** A resolver module; string fields other than `operation` are inserted as source. */
export function resolverSource({
  prelude = "",
  operation = "mutation",
  input,
  permission,
  body = "() => 1",
}: ResolverFixture): string {
  return [
    'import { createResolver, db, t } from "@tailor-platform/sdk";',
    prelude,
    "export default createResolver({",
    '  name: "r",',
    `  operation: ${typeof operation === "string" ? JSON.stringify(operation) : operation.source},`,
    ...(input === undefined ? [] : [`  input: ${input},`]),
    ...(permission === undefined ? [] : [`  permission: ${permission},`]),
    `  ${/^(async )?body\(/.test(body) ? body : `body: ${body}`},`,
    "  output: t.int(),",
    "});",
  ].join("\n");
}
