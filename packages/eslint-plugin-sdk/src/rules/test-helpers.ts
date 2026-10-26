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
