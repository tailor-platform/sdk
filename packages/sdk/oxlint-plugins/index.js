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

const ARG_CALLEE_NAMES = new Set(["arg"]);
const COMMAND_DEFINITION_NAMES = new Set(["defineCommand", "defineAppCommand"]);

function staticPropertyName(prop) {
  if (prop.type !== "Property" || prop.computed) return null;
  if (prop.key.type === "Identifier") return prop.key.name;
  if (prop.key.type === "Literal" && typeof prop.key.value === "string") return prop.key.value;
  return null;
}

function objectProperty(node, name) {
  if (node.type !== "ObjectExpression") return null;
  for (const prop of node.properties) {
    if (staticPropertyName(prop) === name) return prop;
  }
  return null;
}

function isCalleeNamed(callee, names) {
  if (callee.type === "Identifier") return names.has(callee.name);
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier"
  ) {
    return names.has(callee.property.name);
  }
  return false;
}

function isTrueLiteral(node) {
  return node.type === "Literal" && node.value === true;
}

function isArgCallWithPositional(node) {
  if (node.type !== "CallExpression" || !isCalleeNamed(node.callee, ARG_CALLEE_NAMES)) {
    return false;
  }
  const options = node.arguments[1];
  if (!options || options.type !== "ObjectExpression") return false;
  const positional = objectProperty(options, "positional");
  return Boolean(positional && isTrueLiteral(positional.value));
}

function expressionContainsPositionalArg(node, positionalArgVariables = new Set()) {
  if (!node) return false;
  if (node.type === "Identifier") return positionalArgVariables.has(node.name);
  if (isArgCallWithPositional(node)) return true;

  switch (node.type) {
    case "CallExpression":
    case "NewExpression":
      return (
        expressionContainsPositionalArg(node.callee, positionalArgVariables) ||
        node.arguments.some((argNode) =>
          expressionContainsPositionalArg(argNode, positionalArgVariables),
        )
      );
    case "MemberExpression":
      return (
        expressionContainsPositionalArg(node.object, positionalArgVariables) ||
        (node.computed && expressionContainsPositionalArg(node.property, positionalArgVariables))
      );
    case "ObjectExpression":
      return node.properties.some((prop) => {
        if (prop.type === "Property") {
          return expressionContainsPositionalArg(prop.value, positionalArgVariables);
        }
        if (prop.type === "SpreadElement") {
          return expressionContainsPositionalArg(prop.argument, positionalArgVariables);
        }
        return false;
      });
    case "ArrayExpression":
      return node.elements.some((element) =>
        expressionContainsPositionalArg(element, positionalArgVariables),
      );
    case "ConditionalExpression":
      return (
        expressionContainsPositionalArg(node.test, positionalArgVariables) ||
        expressionContainsPositionalArg(node.consequent, positionalArgVariables) ||
        expressionContainsPositionalArg(node.alternate, positionalArgVariables)
      );
    case "LogicalExpression":
    case "BinaryExpression":
    case "AssignmentExpression":
      return (
        expressionContainsPositionalArg(node.left, positionalArgVariables) ||
        expressionContainsPositionalArg(node.right, positionalArgVariables)
      );
    case "ChainExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
      return expressionContainsPositionalArg(node.expression, positionalArgVariables);
    default:
      return false;
  }
}

function expressionContainsIdentifier(node, names) {
  if (!node) return false;
  if (node.type === "Identifier") return names.has(node.name);

  switch (node.type) {
    case "CallExpression":
    case "NewExpression":
      return (
        expressionContainsIdentifier(node.callee, names) ||
        node.arguments.some((argNode) => expressionContainsIdentifier(argNode, names))
      );
    case "MemberExpression":
      return (
        expressionContainsIdentifier(node.object, names) ||
        (node.computed && expressionContainsIdentifier(node.property, names))
      );
    case "ObjectExpression":
      return node.properties.some((prop) => {
        if (prop.type === "Property") return expressionContainsIdentifier(prop.value, names);
        if (prop.type === "SpreadElement")
          return expressionContainsIdentifier(prop.argument, names);
        return false;
      });
    case "ArrayExpression":
      return node.elements.some((element) => expressionContainsIdentifier(element, names));
    case "ConditionalExpression":
      return (
        expressionContainsIdentifier(node.test, names) ||
        expressionContainsIdentifier(node.consequent, names) ||
        expressionContainsIdentifier(node.alternate, names)
      );
    case "LogicalExpression":
    case "BinaryExpression":
    case "AssignmentExpression":
      return (
        expressionContainsIdentifier(node.left, names) ||
        expressionContainsIdentifier(node.right, names)
      );
    case "ChainExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
      return expressionContainsIdentifier(node.expression, names);
    default:
      return false;
  }
}

function isArgsModule(source) {
  return typeof source === "string" && /(^|\/)args$/.test(source);
}

function isArgsBindingName(name) {
  return /Args?$/.test(name);
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

    "no-cli-hybrid-command": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow CLI commands that combine subCommands with command-level positional arguments and run handlers.",
        },
        messages: {
          hybrid:
            "Move the positional argument to a leaf subcommand. Commands with subcommands should not also define command-level positional args and a run handler.",
          opaqueImportedArgs:
            "Inline imported command-level args or move them to a leaf subcommand so this rule can verify there are no positional arguments.",
        },
        schema: [],
      },
      create(context) {
        const importedArgVariables = new Set();
        const positionalArgVariables = new Set();

        function hasCommandLevelPositionalArgs(argsNode) {
          return expressionContainsPositionalArg(argsNode, positionalArgVariables);
        }

        return {
          ImportDeclaration(node) {
            if (!isArgsModule(node.source.value)) return;
            for (const specifier of node.specifiers) {
              if (
                specifier.type === "ImportNamespaceSpecifier" ||
                isArgsBindingName(specifier.local.name)
              ) {
                importedArgVariables.add(specifier.local.name);
              }
            }
          },
          VariableDeclarator(node) {
            if (
              node.id.type === "Identifier" &&
              expressionContainsPositionalArg(node.init, positionalArgVariables)
            ) {
              positionalArgVariables.add(node.id.name);
            }
          },
          CallExpression(node) {
            if (!isCalleeNamed(node.callee, COMMAND_DEFINITION_NAMES)) {
              return;
            }
            const commandOptions = node.arguments[0];
            if (!commandOptions || commandOptions.type !== "ObjectExpression") return;

            const subCommands = objectProperty(commandOptions, "subCommands");
            const run = objectProperty(commandOptions, "run");
            const args = objectProperty(commandOptions, "args");
            const hasPositionalArgs = args && hasCommandLevelPositionalArgs(args.value);
            const hasOpaqueImportedArgs =
              args && expressionContainsIdentifier(args.value, importedArgVariables);
            if (!subCommands || !run || !args || (!hasPositionalArgs && !hasOpaqueImportedArgs)) {
              return;
            }

            context.report({
              node: args,
              messageId: hasPositionalArgs ? "hybrid" : "opaqueImportedArgs",
            });
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
  },
};
