import { bindingNameForCall, isExpressionWrapper, unwrapExpression } from "./ast.js";

function declaredNames(declaration) {
  if (declaration?.type !== "VariableDeclaration") return [];
  return declaration.declarations.flatMap((entry) =>
    entry.id.type === "Identifier" ? [entry.id.name] : [],
  );
}

export function collectExports(program) {
  const named = new Set();
  const defaults = new Set();
  const aliases = new Map();

  for (const statement of program.body) {
    if (statement.type === "ExportDefaultDeclaration") {
      const declaration = unwrapExpression(statement.declaration);
      if (declaration.type === "Identifier") {
        defaults.add(declaration.name);
      }
    }
    const declaration =
      statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (statement.type === "ExportNamedDeclaration") {
      for (const name of declaredNames(declaration)) {
        named.add(name);
      }
      if (statement.source === null) {
        for (const specifier of statement.specifiers) {
          if (
            specifier.type !== "ExportSpecifier" ||
            specifier.exportKind === "type" ||
            specifier.local.type !== "Identifier"
          ) {
            continue;
          }
          const exported =
            specifier.exported.type === "Identifier"
              ? specifier.exported.name
              : String(specifier.exported.value);
          if (exported === "default") {
            defaults.add(specifier.local.name);
          } else {
            named.add(specifier.local.name);
          }
        }
      }
    }
    if (declaration?.type === "VariableDeclaration") {
      for (const entry of declaration.declarations) {
        const value = unwrapExpression(entry.init);
        if (entry.id.type === "Identifier" && value?.type === "Identifier") {
          aliases.set(entry.id.name, value.name);
        }
      }
    }
  }

  for (const exported of [named, defaults]) {
    for (const name of exported) {
      const seen = new Set([name]);
      let current = name;
      while (aliases.has(current)) {
        current = aliases.get(current);
        if (seen.has(current)) break;
        exported.add(current);
        seen.add(current);
      }
    }
  }

  return { named, defaults };
}

function isDirectExport(call, exportType) {
  let current = call;
  while (isExpressionWrapper(current.parent)) {
    current = current.parent;
  }
  return current.parent?.type === exportType && current.parent.declaration === current;
}

export function exportStatus(call, exports) {
  const bindingName = bindingNameForCall(call);
  return {
    isDefault:
      isDirectExport(call, "ExportDefaultDeclaration") ||
      (bindingName !== null && exports.defaults.has(bindingName)),
    isNamed:
      isDirectExport(call, "ExportNamedDeclaration") ||
      (bindingName !== null && exports.named.has(bindingName)),
  };
}
