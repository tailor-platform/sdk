import noApiPrefixInPathPattern from "./rules/no-api-prefix-in-path-pattern.js";
import noExecuteScriptArgStringify from "./rules/no-execute-script-arg-stringify.js";
import noUnconditionalPermit from "./rules/no-unconditional-permit.js";

const rules = {
  "no-api-prefix-in-path-pattern": noApiPrefixInPathPattern,
  "no-execute-script-arg-stringify": noExecuteScriptArgStringify,
  "no-unconditional-permit": noUnconditionalPermit,
};

const plugin = {
  meta: {
    name: "@tailor-platform/eslint-plugin-sdk",
  },
  rules,
  configs: {},
};

plugin.configs.recommended = {
  name: "tailor-sdk/recommended",
  plugins: {
    "tailor-sdk": plugin,
  },
  rules: {
    "tailor-sdk/no-api-prefix-in-path-pattern": "warn",
    "tailor-sdk/no-execute-script-arg-stringify": "warn",
    "tailor-sdk/no-unconditional-permit": "warn",
  },
};

export default plugin;
