import noApiPrefixInPathPattern from "./rules/no-api-prefix-in-path-pattern.js";
import noDeprecatedApi from "./rules/no-deprecated-api.js";
import noResumeAfterResolve from "./rules/no-resume-after-resolve.js";
import oneServicePerFile from "./rules/one-service-per-file.js";
import requireNamedWorkflowJobExport from "./rules/require-named-workflow-job-export.js";
import requireServiceDefaultExport from "./rules/require-service-default-export.js";

const rules = {
  "no-api-prefix-in-path-pattern": noApiPrefixInPathPattern,
  "no-deprecated-api": noDeprecatedApi,
  "no-resume-after-resolve": noResumeAfterResolve,
  "one-service-per-file": oneServicePerFile,
  "require-named-workflow-job-export": requireNamedWorkflowJobExport,
  "require-service-default-export": requireServiceDefaultExport,
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
    "tailor-sdk/no-deprecated-api": "warn",
    "tailor-sdk/no-resume-after-resolve": "warn",
    "tailor-sdk/one-service-per-file": "error",
    "tailor-sdk/require-named-workflow-job-export": "error",
    "tailor-sdk/require-service-default-export": "error",
  },
};

export default plugin;
