"use strict";

const STRIP_COMMENT_PATTERN = /\bstrip\b/i;

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

function isZObjectCall(node) {
  return (
    node.callee.type === "MemberExpression" &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "z" &&
    getPropertyName(node.callee.property) === "object"
  );
}

function commentMentionsStrip(comment) {
  return STRIP_COMMENT_PATTERN.test(comment.value);
}

function hasStripComment(sourceCode, node) {
  const commentsBefore = sourceCode.getCommentsBefore(node);
  const hasLeadingStripComment = commentsBefore.some(
    (comment) => comment.loc.end.line >= node.loc.start.line - 1 && commentMentionsStrip(comment),
  );

  if (hasLeadingStripComment) {
    return true;
  }

  return sourceCode
    .getCommentsAfter(node)
    .some(
      (comment) => comment.loc.start.line === node.loc.end.line && commentMentionsStrip(comment),
    );
}

module.exports = {
  meta: {
    name: "tailor-zod",
  },
  rules: {
    "require-strip-comment-for-object": {
      meta: {
        type: "problem",
        docs: {
          description: "Require a strip-policy comment for z.object().",
        },
        schema: [],
        messages: {
          missingStripComment:
            'Add a comment containing "strip" for z.object(), or use z.strictObject() / z.looseObject().',
        },
      },
      create(context) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();

        return {
          CallExpression(node) {
            if (isZObjectCall(node) && !hasStripComment(sourceCode, node)) {
              context.report({
                node,
                messageId: "missingStripComment",
              });
            }
          },
        };
      },
    },
  },
};
