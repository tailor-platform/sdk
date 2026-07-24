import type { ESLint, Linter, Rule } from "eslint";

export type TailorSdkRuleName =
  | "no-api-prefix-in-path-pattern"
  | "no-execute-script-arg-stringify"
  | "no-unconditional-permit";

type RecommendedRules = {
  readonly [RuleName in TailorSdkRuleName as `tailor-sdk/${RuleName}`]: Linter.RuleEntry;
};

export interface TailorSdkPlugin extends Omit<ESLint.Plugin, "configs" | "meta" | "rules"> {
  readonly meta: {
    readonly name: "@tailor-platform/eslint-plugin-sdk";
  };
  readonly rules: Record<TailorSdkRuleName, Rule.RuleModule>;
  readonly configs: {
    readonly recommended: Linter.Config<RecommendedRules>;
  };
}

declare const plugin: TailorSdkPlugin;

export default plugin;
