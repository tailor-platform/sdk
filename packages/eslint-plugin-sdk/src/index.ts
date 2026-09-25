import noApiPrefixInPathPattern from "./rules/no-api-prefix-in-path-pattern.js";
import noDirectExecJobFunction from "./rules/no-direct-exec-job-function.js";
import noExecuteScriptArgStringify from "./rules/no-execute-script-arg-stringify.js";
import noJobStartOutsideBody from "./rules/no-job-start-outside-body.js";
import noNodeBuiltinImports from "./rules/no-node-builtin-imports.js";
import noNodeOnlyGlobals from "./rules/no-node-only-globals.js";
import noUnconditionalPermit from "./rules/no-unconditional-permit.js";
import validExecutionPolicyDefinition from "./rules/valid-execution-policy-definition.js";
import validResolverPermission from "./rules/valid-resolver-permission.js";
import validWorkflowExports from "./rules/valid-workflow-exports.js";
import validWorkflowJobDefinition from "./rules/valid-workflow-job-definition.js";
import validWorkflowRetryPolicy from "./rules/valid-workflow-retry-policy.js";
import type { ESLint, Linter, Rule } from "eslint";

function defineRules<const Rules extends Record<string, Rule.RuleModule>>(
  rules: Rules,
): { [RuleName in keyof Rules]: Rule.RuleModule } {
  return rules;
}

const rules = defineRules({
  "no-api-prefix-in-path-pattern": noApiPrefixInPathPattern,
  "no-direct-exec-job-function": noDirectExecJobFunction,
  "no-execute-script-arg-stringify": noExecuteScriptArgStringify,
  "no-job-start-outside-body": noJobStartOutsideBody,
  "no-node-builtin-imports": noNodeBuiltinImports,
  "no-node-only-globals": noNodeOnlyGlobals,
  "no-unconditional-permit": noUnconditionalPermit,
  "valid-execution-policy-definition": validExecutionPolicyDefinition,
  "valid-resolver-permission": validResolverPermission,
  "valid-workflow-exports": validWorkflowExports,
  "valid-workflow-job-definition": validWorkflowJobDefinition,
  "valid-workflow-retry-policy": validWorkflowRetryPolicy,
});

export type TailorSdkRuleName = keyof typeof rules;

type RecommendedRules = {
  readonly [RuleName in TailorSdkRuleName as `tailor-sdk/${RuleName}`]: Linter.RuleEntry;
};

type RecommendedConfig = Linter.Config<RecommendedRules>;

export interface TailorSdkPlugin extends Omit<ESLint.Plugin, "configs" | "meta" | "rules"> {
  readonly meta: {
    readonly name: "@tailor-platform/eslint-plugin-sdk";
  };
  readonly rules: Record<TailorSdkRuleName, Rule.RuleModule>;
  readonly configs: {
    readonly recommended: RecommendedConfig;
  };
}

const configs = {} as { recommended: RecommendedConfig };
const plugin: TailorSdkPlugin = {
  meta: {
    name: "@tailor-platform/eslint-plugin-sdk",
  },
  rules,
  configs,
};

configs.recommended = {
  name: "tailor-sdk/recommended",
  plugins: {
    "tailor-sdk": plugin,
  },
  rules: Object.fromEntries(
    Object.keys(rules).map((name) => [`tailor-sdk/${name}`, "warn"]),
  ) as RecommendedRules,
};

export default plugin;
