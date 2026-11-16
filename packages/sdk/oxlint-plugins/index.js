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
  const names = new Set();
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
    if (!nameMatch) continue;
    // Record both the full dotted form (`obj.id`) and the leaf identifier
    // (`id`) so the lookup matches either documentation style.
    const full = nameMatch[1];
    names.add(full);
    const leaf = full.includes(".") ? full.split(".").pop() : full;
    if (leaf) names.add(leaf);
  }
  return names;
}

// Returns one [{ astNode, names: string[] }] entry per function parameter.
// `names` is the set of identifier names that must be documented in JSDoc:
// the parameter itself for plain identifiers, the destructured leaves for
// object/array patterns (matching the repo JSDoc convention of one
// `@param obj.prop` per leaf).
function functionParamSlots(node) {
  function collect(target) {
    if (target.type === "Identifier") return [target.name];
    if (target.type === "RestElement") return collect(target.argument);
    if (target.type === "AssignmentPattern") return collect(target.left);
    if (target.type === "ObjectPattern") {
      const names = [];
      for (const prop of target.properties) {
        if (prop.type === "RestElement") {
          names.push(...collect(prop.argument));
        } else if (prop.value && prop.value.type !== "Identifier") {
          names.push(...collect(prop.value));
        } else if (prop.key && prop.key.type === "Identifier") {
          names.push(prop.key.name);
        }
      }
      return names;
    }
    if (target.type === "ArrayPattern") {
      const names = [];
      for (const el of target.elements) {
        if (el) names.push(...collect(el));
      }
      return names;
    }
    return [];
  }
  return node.params.map((p) => ({ astNode: p, names: collect(p) }));
}

export default {
  meta: { name: "local" },
  rules: {
    // CLI modules must fail through CLIError({ code, ... }) so `--json`
    // output carries a stable code, or through internalError() for SDK
    // invariant violations. A bare `new Error()` surfaces as UNEXPECTED_ERROR.
    "no-plain-error": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Ban `new Error()` and Error subclasses in CLI modules in favour of CLIError({ code }) or internalError().",
        },
        messages: {
          plainError:
            "Use CLIError({ code, ... }) for user-actionable failures or internalError() for SDK invariant violations; a plain Error is reported as UNEXPECTED_ERROR under --json.",
          errorSubclass:
            "Do not subclass Error in CLI modules; throw CLIError({ code, ... }) and branch on error.code instead.",
        },
        schema: [],
      },
      create(context) {
        function check(node) {
          if (node.callee.type === "Identifier" && node.callee.name === "Error") {
            context.report({ node, messageId: "plainError" });
          }
        }
        function checkClass(node) {
          if (node.superClass?.type === "Identifier" && node.superClass.name === "Error") {
            context.report({ node: node.superClass, messageId: "errorSubclass" });
          }
        }
        return {
          NewExpression: check,
          CallExpression: check,
          ClassDeclaration: checkClass,
          ClassExpression: checkClass,
        };
      },
    },

    // A ZodError reaching the top level is reported as UNEXPECTED_ERROR. Schemas are
    // recognised by name (`z`, `*Schema`), so a destructured `{ error }` or a parse
    // result returned by a helper goes unreported.
    "no-raw-zod-error": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Ban throwing Zod parses and rethrown safeParse errors in CLI modules in favour of CLIError({ code }) or internalError().",
        },
        messages: {
          throwingParse:
            "Use safeParse() and throw CLIError({ code, ... }) for user input (see cli/shared/validation-errors.ts), or internalError() for SDK or Platform data; a ZodError is reported as UNEXPECTED_ERROR under --json.",
          rethrow:
            "Wrap the issues in CLIError({ code, ... }) (see cli/shared/validation-errors.ts) or internalError() instead of rethrowing the ZodError.",
        },
        schema: [],
      },
      create(context) {
        const throwingMethods = new Set([
          "parse",
          "parseAsync",
          "decode",
          "decodeAsync",
          "encode",
          "encodeAsync",
        ]);
        const safeMethods = new Set([
          "safeParse",
          "safeParseAsync",
          "safeDecode",
          "safeDecodeAsync",
          "safeEncode",
          "safeEncodeAsync",
        ]);

        function methodName(callee) {
          return callee.type === "MemberExpression" &&
            !callee.computed &&
            callee.property.type === "Identifier"
            ? callee.property.name
            : undefined;
        }

        function isSchemaChain(node) {
          let current = node;
          while (current.type === "CallExpression" || current.type === "MemberExpression") {
            current = current.type === "CallExpression" ? current.callee : current.object;
          }
          return (
            current.type === "Identifier" &&
            (current.name === "z" || /[sS]chema$/.test(current.name))
          );
        }

        function isSafeParseCall(node) {
          const call = node?.type === "AwaitExpression" ? node.argument : node;
          return call?.type === "CallExpression" && safeMethods.has(methodName(call.callee));
        }

        function resolveVariable(node, name) {
          for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper) {
            const variable = scope.set.get(name);
            if (variable) return variable;
          }
          return undefined;
        }

        return {
          CallExpression(node) {
            if (throwingMethods.has(methodName(node.callee)) && isSchemaChain(node.callee.object)) {
              context.report({ node, messageId: "throwingParse" });
            }
          },
          ThrowStatement(node) {
            const thrown = node.argument;
            if (
              thrown?.type !== "MemberExpression" ||
              methodName(thrown) !== "error" ||
              thrown.object.type !== "Identifier"
            ) {
              return;
            }
            const variable = resolveVariable(node, thrown.object.name);
            if (variable?.defs.some((def) => isSafeParseCall(def.node.init))) {
              context.report({ node, messageId: "rethrow" });
            }
          },
        };
      },
    },

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
          for (let i = ancestors.length - 1; i >= 0; i--) {
            const parent = ancestors[i];
            const wraps =
              (parent.type === "VariableDeclarator" && parent.init === target) ||
              (parent.type === "VariableDeclaration" && parent.declarations.includes(target)) ||
              (parent.type === "ExportNamedDeclaration" && parent.declaration === target) ||
              (parent.type === "ExportDefaultDeclaration" && parent.declaration === target) ||
              (parent.type === "MethodDefinition" && parent.value === target) ||
              (parent.type === "Property" && parent.value === target) ||
              (parent.type === "PropertyDefinition" && parent.value === target);
            if (!wraps) break;
            target = parent;
          }
          return target;
        }

        function checkFunction(node) {
          const ancestors = context.sourceCode.getAncestors(node);
          const carrier = jsdocCarrier(node, ancestors);
          const block = jsdocBlockBefore(context.sourceCode, carrier);
          if (!block) return;
          const documented = paramNamesFromJsdoc(block);
          for (const slot of functionParamSlots(node)) {
            // A slot with no extractable names (e.g. a TypeScript-only
            // `this:` parameter) is treated as documented.
            if (slot.names.length === 0) continue;
            const missing = slot.names.find((n) => !documented.has(n));
            if (missing) {
              context.report({
                node: slot.astNode,
                messageId: "missing",
                data: { name: missing },
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

    "typed-operator-client-mock": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Require operator client mocks in tests to go through mockOperatorClient() so their responses are type-checked.",
        },
        messages: {
          cast: "Build the operator client mock with mockOperatorClient(); a cast leaves its requests and responses unchecked.",
          spy: "Give mockOperatorClient() the response or an implementation; it makes the vi.fn spy, and a spy passed in leaves the response unchecked.",
        },
        schema: [],
      },
      create(context) {
        const clientFactories = new Set([
          "initOperatorClient",
          "createPatOperatorClient",
          "loadOperatorWorkspaceContext",
        ]);
        function namesOperatorClient(type) {
          if (type?.type === "TSTypeReference" && type.typeName.name === "OperatorClient") {
            return true;
          }
          if (type?.type === "TSTypeQuery" && clientFactories.has(type.exprName.name)) {
            return true;
          }
          if (type?.type === "TSIndexedAccessType") {
            return type.indexType.literal?.value === "client";
          }
          if (type?.type === "TSIntersectionType" || type?.type === "TSUnionType") {
            return type.types.some(namesOperatorClient);
          }
          return (type?.typeArguments?.params ?? []).some(namesOperatorClient);
        }
        function isMockedClientFactory(node) {
          const mocked = node?.type === "MemberExpression" ? node.object : undefined;
          return (
            mocked?.type === "CallExpression" &&
            mocked.callee.type === "MemberExpression" &&
            mocked.callee.object.name === "vi" &&
            mocked.callee.property.name === "mocked" &&
            clientFactories.has(mocked.arguments[0]?.name)
          );
        }
        function isUncheckedCast(node) {
          return (
            node.type === "TSAsExpression" &&
            (node.typeAnnotation.type === "TSNeverKeyword" ||
              node.typeAnnotation.type === "TSAnyKeyword")
          );
        }
        function isViFn(node) {
          return (
            node.callee.type === "MemberExpression" &&
            node.callee.object.type === "Identifier" &&
            node.callee.object.name === "vi" &&
            node.callee.property.name === "fn"
          );
        }
        function isSpy(node) {
          let current = node;
          while (current?.type === "CallExpression") {
            if (isViFn(current)) return true;
            current =
              current.callee.type === "MemberExpression" ? current.callee.object : undefined;
          }
          return false;
        }
        function definitionOf(identifier) {
          for (let scope = context.sourceCode.getScope(identifier); scope; scope = scope.upper) {
            const definition = scope.set.get(identifier.name)?.defs[0];
            if (definition) return definition;
          }
          return undefined;
        }
        function initializerOf(identifier) {
          const definition = definitionOf(identifier);
          return definition?.node.type === "VariableDeclarator" ? definition.node.init : undefined;
        }
        function isMockOperatorClient(callee) {
          if (callee.type !== "Identifier") return false;
          const definition = definitionOf(callee);
          return (
            definition?.type === "ImportBinding" &&
            definition.parent.source.value.endsWith("/test-helpers/operator-client")
          );
        }
        function checkCast(node) {
          if (namesOperatorClient(node.typeAnnotation)) {
            context.report({ node, messageId: "cast" });
          }
        }
        return {
          TSAsExpression: checkCast,
          TSTypeAssertion: checkCast,
          CallExpression(node) {
            if (isMockedClientFactory(node.callee)) {
              for (const argument of node.arguments.filter(isUncheckedCast)) {
                context.report({ node: argument, messageId: "cast" });
              }
              return;
            }
            if (!isMockOperatorClient(node.callee)) return;
            const [methods] = node.arguments;
            if (methods?.type !== "ObjectExpression") return;
            for (const property of methods.properties) {
              if (property.type !== "Property") continue;
              const value =
                property.value.type === "Identifier"
                  ? initializerOf(property.value)
                  : property.value;
              if (isSpy(value)) {
                context.report({ node: property.value, messageId: "spy" });
              }
            }
          },
        };
      },
    },
  },
};
