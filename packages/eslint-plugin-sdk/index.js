import noApiPrefixInPathPattern from "./rules/no-api-prefix-in-path-pattern.js";

const rules = {
  "no-api-prefix-in-path-pattern": noApiPrefixInPathPattern,
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
  },
};

export default plugin;
