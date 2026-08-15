"use strict";

const OBJECT_POLICY_COMMENT_PATTERN = /\b(catchall|strip)\b/i;

function getPropertyName(property) {
  if (property == null) {
    return undefined;
  }

  if (property.type === "Identifier") {
    return property.name;
  }

  if (property.type === "Literal") {
    return property.value;
  }

  return undefined;
}

function isVObjectCall(node) {
  return (
    node.callee.type === "MemberExpression" &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "v" &&
    getPropertyName(node.callee.property) === "object"
  );
}

function hasObjectPolicyComment(sourceCode, node) {
  const previousLine = sourceCode.getText().split(/\r?\n/)[node.loc.start.line - 2] ?? "";
  const trimmedPreviousLine = previousLine.trimStart();
  return (
    (trimmedPreviousLine.startsWith("//") || trimmedPreviousLine.startsWith("/*")) &&
    OBJECT_POLICY_COMMENT_PATTERN.test(trimmedPreviousLine)
  );
}

module.exports = {
  meta: {
    name: "tailor-valibot",
  },
  rules: {
    "require-object-policy-comment": {
      meta: {
        type: "problem",
        docs: {
          description: "Require an unknown-key policy comment for v.object().",
        },
        schema: [],
        messages: {
          missingObjectPolicyComment:
            'Add a previous-line comment containing "strip" or "catchall" for v.object(), or use v.strictObject() / v.looseObject().',
        },
      },
      create(context) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();

        return {
          CallExpression(node) {
            if (isVObjectCall(node) && !hasObjectPolicyComment(sourceCode, node)) {
              context.report({
                node,
                messageId: "missingObjectPolicyComment",
              });
            }
          },
        };
      },
    },
  },
};
