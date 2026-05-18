// Replacement for the ESLint `no-restricted-syntax` rule that flagged
// `*.toMatchTypeOf()` calls in test files. Loaded by oxlint as a JS plugin
// (alpha). See packages/sdk/.oxlintrc.json `jsPlugins`.

/** @type {import('eslint').ESLint.Plugin} */
export default {
  meta: { name: "local" },
  rules: {
    "no-deprecated-type-matcher": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Ban deprecated vitest type matchers like toMatchTypeOf in favour of toEqualTypeOf / toMatchObjectType / toExtend.",
        },
        messages: {
          banned:
            "toMatchTypeOf is deprecated. Use toEqualTypeOf, toMatchObjectType, or toExtend instead.",
        },
        schema: [],
      },
      create(context) {
        return {
          CallExpression(node) {
            const callee = node.callee;
            if (
              callee.type === "MemberExpression" &&
              callee.property.type === "Identifier" &&
              callee.property.name === "toMatchTypeOf"
            ) {
              context.report({ node: callee.property, messageId: "banned" });
            }
          },
        };
      },
    },
  },
};
