import rootConfig from "../../eslint.config.js";

export default [
  ...rootConfig,
  {
    ignores: [
      "tailordb.ts",
      "tailordb/types.ts",
      ".tailor-sdk/**",
      "tests/fixtures/**",
    ],
  },
];
