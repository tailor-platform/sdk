// Local oxlint JS plugin — bundles every rule we need that oxlint does not
// (yet) provide natively. Loaded by oxlint as a JS plugin (alpha). See
// packages/sdk/.oxlintrc.json `jsPlugins`.

import path from "node:path";

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

function isCallArgument(node, parent) {
  return (
    (parent?.type === "CallExpression" || parent?.type === "NewExpression") &&
    parent.callee !== node
  );
}

function objectLiteralType(annotation) {
  if (annotation?.type === "TSTypeLiteral") return annotation;
  if (annotation?.type !== "TSUnionType") return undefined;
  const rest = annotation.types.filter(
    (type) => type.type !== "TSUndefinedKeyword" && type.type !== "TSNullKeyword",
  );
  return rest.length === 1 && rest[0].type === "TSTypeLiteral" ? rest[0] : undefined;
}

function memberKeyName(member) {
  if (member.computed) return undefined;
  if (member.key?.type === "Identifier") return member.key.name;
  if (typeof member.key?.value === "string") return member.key.value;
  return undefined;
}

function resolveVariable(context, node, name) {
  for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(name);
    if (variable) return variable;
  }
  return undefined;
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
            const variable = resolveVariable(context, node, thrown.object.name);
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

    "require-named-param-type": {
      meta: {
        type: "suggestion",
        docs: {
          description:
            "Require a named type for an object parameter unless the function's JSDoc documents each of its properties.",
        },
        messages: {
          inline:
            "Extract the type of parameter '{{name}}' into a named type or interface, or, when every property has a name, document each with `@param {{name}}.<property>`.",
        },
        schema: [],
      },
      create(context) {
        function checkFunction(node) {
          const ancestors = context.sourceCode.getAncestors(node);
          const parent = ancestors[ancestors.length - 1];
          // A callback written inline, alone or as a property of an object argument, carries no JSDoc.
          if (isCallArgument(node, parent)) return;
          if (
            parent?.type === "Property" &&
            parent.value === node &&
            isCallArgument(ancestors[ancestors.length - 2], ancestors[ancestors.length - 3])
          ) {
            return;
          }
          let documented;
          for (const param of node.params) {
            const declared = param.type === "TSParameterProperty" ? param.parameter : param;
            const target = declared.type === "AssignmentPattern" ? declared.left : declared;
            if (target.type !== "Identifier") continue;
            const literal = objectLiteralType(target.typeAnnotation?.typeAnnotation);
            if (!literal) continue;
            if (!documented) {
              const block = jsdocBlockBefore(context.sourceCode, jsdocCarrier(node, ancestors));
              documented = block ? paramNamesFromJsdoc(block) : new Set();
            }
            const covered = literal.members.every((member) => {
              const key = memberKeyName(member);
              return key !== undefined && documented.has(`${target.name}.${key}`);
            });
            if (!covered) {
              context.report({ node: param, messageId: "inline", data: { name: target.name } });
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
            "Require operator client mocks in tests to go through mockOperatorClient() and keep their requests and responses type-checked.",
        },
        messages: {
          cast: "Build the operator client mock with mockOperatorClient(); a cast leaves its requests and responses unchecked.",
          response:
            "Give the mocked operator client method a response of its RPC's type; an `as never` or `as any` response goes unchecked.",
          request:
            "Leave the mocked operator client method's request parameter unannotated so it takes the RPC's request type.",
        },
        schema: [],
      },
      create(context) {
        const clientFactories = new Set([
          "initOperatorClient",
          "createPatOperatorClient",
          "loadOperatorWorkspaceContext",
        ]);
        function exportedName(node) {
          switch (node?.type) {
            case "Identifier": {
              const definition = resolveVariable(context, node, node.name)?.defs[0];
              return definition?.type === "ImportBinding"
                ? (definition.node.imported?.name ?? node.name)
                : node.name;
            }
            case "TSQualifiedName":
              return node.right.name;
            case "MemberExpression":
              return node.computed ? undefined : node.property.name;
            case "TSImportType":
              return node.qualifier?.name;
            default:
              return undefined;
          }
        }
        function namesOperatorClient(type) {
          if (
            (type?.type === "TSTypeReference" &&
              exportedName(type.typeName) === "OperatorClient") ||
            (type?.type === "TSImportType" && exportedName(type) === "OperatorClient")
          ) {
            return true;
          }
          if (type?.type === "TSTypeQuery" && clientFactories.has(exportedName(type.exprName))) {
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
        const responseSetters = new Set([
          "mockResolvedValue",
          "mockResolvedValueOnce",
          "mockReturnValue",
          "mockReturnValueOnce",
        ]);
        const implementationSetters = new Set(["mockImplementation", "mockImplementationOnce"]);
        const methodMocksArgument = new Map([
          ["mockOperatorClient", 0],
          ["withOperatorClientMocks", 1],
        ]);
        const functionTypes = new Set([
          "FunctionDeclaration",
          "FunctionExpression",
          "ArrowFunctionExpression",
        ]);
        function calledMember(callee) {
          return callee?.type === "MemberExpression" && !callee.computed
            ? callee.property.name
            : undefined;
        }
        function mockedTarget(node) {
          let mocked = node;
          while (
            mocked?.type === "CallExpression" &&
            /^mock[A-Z]/.test(calledMember(mocked.callee))
          ) {
            mocked = mocked.callee.object;
          }
          const viMocked =
            mocked?.type === "CallExpression" &&
            mocked.callee.type === "MemberExpression" &&
            mocked.callee.object.name === "vi" &&
            mocked.callee.property.name === "mocked";
          return { target: viMocked ? mocked.arguments[0] : mocked, viMocked };
        }
        function isMockedClientFactory(callee) {
          if (callee?.type !== "MemberExpression") return false;
          const { target, viMocked } = mockedTarget(callee.object);
          return viMocked && clientFactories.has(exportedName(target));
        }
        function isClientMethod(node) {
          const { target } = mockedTarget(node);
          if (target?.type !== "MemberExpression" || target.computed) return false;
          if (clientFactories.has(target.property.name)) return false;
          const receiver =
            target.object.type === "MemberExpression" ? target.object.property : target.object;
          return receiver.type === "Identifier" && /client$/i.test(receiver.name);
        }
        function isMethodMocks(node) {
          const call = node?.parent;
          return (
            node.type === "ObjectExpression" &&
            call?.type === "CallExpression" &&
            call.arguments[methodMocksArgument.get(exportedName(call.callee))] === node
          );
        }
        function isMockImplementation(fn) {
          const parent = fn?.parent;
          if (parent?.type === "Property") {
            return parent.value === fn && isMethodMocks(parent.parent);
          }
          return (
            parent?.type === "CallExpression" &&
            parent.arguments.includes(fn) &&
            implementationSetters.has(calledMember(parent.callee)) &&
            isClientMethod(parent.callee.object)
          );
        }
        function enclosingFunction(node) {
          let current = node.parent;
          while (current && !functionTypes.has(current.type)) current = current.parent;
          return current;
        }
        function isUncheckedCast(node) {
          return (
            node.type === "TSAsExpression" &&
            (node.typeAnnotation.type === "TSNeverKeyword" ||
              node.typeAnnotation.type === "TSAnyKeyword")
          );
        }
        function checkCast(node) {
          if (namesOperatorClient(node.typeAnnotation)) {
            context.report({ node, messageId: "cast" });
          }
        }
        function checkResponse(node) {
          let response = node;
          while (response?.type === "ParenthesizedExpression") response = response.expression;
          if (response && isUncheckedCast(response)) {
            context.report({ node: response, messageId: "response" });
          }
        }
        function checkImplementation(fn) {
          if (!isMockImplementation(fn)) return;
          for (const param of fn.params) {
            if ((param.type === "AssignmentPattern" ? param.left : param).typeAnnotation) {
              context.report({ node: param, messageId: "request" });
            }
          }
          if (fn.body.type !== "BlockStatement") checkResponse(fn.body);
        }
        function checkReturned(node) {
          if (isMockImplementation(enclosingFunction(node))) checkResponse(node.argument);
        }
        return {
          TSAsExpression: checkCast,
          TSTypeAssertion: checkCast,
          CallExpression(node) {
            if (isMockedClientFactory(node.callee)) {
              for (const argument of node.arguments.filter(isUncheckedCast)) {
                context.report({ node: argument, messageId: "cast" });
              }
            } else if (
              responseSetters.has(calledMember(node.callee)) &&
              isClientMethod(node.callee.object)
            ) {
              checkResponse(node.arguments[0]);
            }
          },
          Property(node) {
            if (isMethodMocks(node.parent)) checkResponse(node.value);
          },
          ArrowFunctionExpression: checkImplementation,
          FunctionExpression: checkImplementation,
          ReturnStatement: checkReturned,
          YieldExpression: checkReturned,
        };
      },
    },

    "logger-mock-import-original": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Require logger mock factories in tests to take importOriginal, so the mock keeps the logger module's other exports.",
        },
        messages: {
          factory:
            "Take importOriginal in the logger mock factory and spread its result; a factory without it drops the logger module's other exports, which modules this test imports indirectly may read.",
        },
        schema: [],
      },
      create(context) {
        const loggerModule = "src/cli/shared/logger";
        function specifier(node) {
          const literal = node?.type === "ImportExpression" ? node.source : node;
          return literal?.type === "Literal" && typeof literal.value === "string"
            ? literal.value
            : undefined;
        }
        function isLoggerModule(spec) {
          let resolved;
          if (spec.startsWith("#/")) resolved = `src/${spec.slice(2)}`;
          else if (spec.startsWith("."))
            resolved = path.resolve(path.dirname(context.filename), spec);
          else return false;
          const normalized = resolved.replaceAll("\\", "/").replace(/\.[cm]?[jt]s$/, "");
          return normalized === loggerModule || normalized.endsWith(`/${loggerModule}`);
        }
        return {
          CallExpression(node) {
            const { callee } = node;
            if (
              callee.type !== "MemberExpression" ||
              callee.computed ||
              callee.object.type !== "Identifier" ||
              callee.object.name !== "vi" ||
              (callee.property.name !== "mock" && callee.property.name !== "doMock")
            ) {
              return;
            }
            const [target, factory] = node.arguments;
            const spec = specifier(target);
            if (spec === undefined || !isLoggerModule(spec)) return;
            if (
              (factory?.type === "ArrowFunctionExpression" ||
                factory?.type === "FunctionExpression") &&
              factory.params.length === 0
            ) {
              context.report({ node: factory, messageId: "factory" });
            }
          },
        };
      },
    },
  },
};
