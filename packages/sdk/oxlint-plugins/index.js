// Local oxlint JS plugin — bundles every rule we need that oxlint does not
// (yet) provide natively. Loaded by oxlint as a JS plugin (alpha). See
// packages/sdk/.oxlintrc.json `jsPlugins`.

function jsdocBlockBefore(sourceCode, node) {
  const comments = sourceCode.getCommentsBefore(node);
  if (!comments?.length) return null;
  const last = comments[comments.length - 1];
  if (last.type !== "Block" || !last.value.startsWith("*")) return null;
  return last;
}

function paramNamesFromJsdoc(block) {
  const names = [];
  for (const line of block.value.split("\n")) {
    const head = line.match(/^\s*\*?\s*@param\s+/);
    if (!head) continue;
    // After `@param `, the remainder may begin with a `{...}` type that
    // contains nested braces (e.g. `{Record<string, { name: ... }>}`). Skip a
    // balanced brace block before parsing the parameter name.
    let rest = line.slice(head[0].length);
    if (rest.startsWith("{")) {
      let depth = 0;
      let i = 0;
      for (; i < rest.length; i++) {
        if (rest[i] === "{") depth++;
        else if (rest[i] === "}" && --depth === 0) {
          i++;
          break;
        }
      }
      rest = rest.slice(i).replace(/^\s+/, "");
    }
    const nameMatch = rest.match(/^\[?([\w$.]+)(?:=[^\]]*)?\]?/);
    if (nameMatch) names.push(nameMatch[1]);
  }
  return names;
}

function functionParamNames(node) {
  return node.params.map((p) => {
    if (p.type === "Identifier") return p.name;
    if (p.type === "RestElement" && p.argument.type === "Identifier") return p.argument.name;
    if (p.type === "AssignmentPattern" && p.left.type === "Identifier") return p.left.name;
    return null;
  });
}

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

    // Strict re-implementation of eslint-plugin-jsdoc's `require-param`.
    // oxlint's native rule has a bug where inner functions inherit the outer
    // function's JSDoc, causing false positives on nested helpers. This rule
    // only checks JSDoc attached directly to the function node.
    "require-param-strict": {
      meta: {
        type: "suggestion",
        docs: {
          description:
            "Require @param tags for every parameter when a JSDoc block is attached directly to the function (mirrors eslint-plugin-jsdoc semantics).",
        },
        messages: {
          missing: "Missing JSDoc `@param` tag for parameter '{{name}}'.",
        },
        schema: [],
      },
      create(context) {
        // Find the nearest enclosing node that the JSDoc block could be
        // attached to. For `function foo() {}` that's the function itself;
        // for `export const foo = () => {}` it's the VariableDeclaration (or
        // the wrapping ExportNamedDeclaration); for `class C { m() {} }`
        // it's the MethodDefinition; for `{ m() {} }` it's the Property.
        function jsdocCarrier(node, ancestors) {
          let target = node;
          // Walk outward through wrappers that carry the JSDoc above them.
          for (let i = ancestors.length - 1; i >= 0; i--) {
            const parent = ancestors[i];
            if (parent.type === "VariableDeclarator" && parent.init === target) {
              target = parent;
              continue;
            }
            if (parent.type === "VariableDeclaration" && parent.declarations.includes(target)) {
              target = parent;
              continue;
            }
            if (parent.type === "ExportNamedDeclaration" && parent.declaration === target) {
              target = parent;
              continue;
            }
            if (parent.type === "MethodDefinition" && parent.value === target) {
              target = parent;
              continue;
            }
            if (parent.type === "Property" && parent.value === target) {
              target = parent;
              continue;
            }
            if (parent.type === "PropertyDefinition" && parent.value === target) {
              target = parent;
              continue;
            }
            break;
          }
          return target;
        }

        function checkFunction(node) {
          const ancestors = context.sourceCode.getAncestors(node);
          const carrier = jsdocCarrier(node, ancestors);
          const block = jsdocBlockBefore(context.sourceCode, carrier);
          if (!block) return;
          const documented = new Set(paramNamesFromJsdoc(block));
          const params = functionParamNames(node);
          for (let i = 0; i < params.length; i++) {
            const name = params[i];
            if (name == null) continue;
            if (!documented.has(name)) {
              context.report({
                node: node.params[i],
                messageId: "missing",
                data: { name },
              });
              return;
            }
          }
        }

        return {
          FunctionDeclaration: checkFunction,
          FunctionExpression: checkFunction,
          ArrowFunctionExpression: checkFunction,
        };
      },
    },
  },
};
