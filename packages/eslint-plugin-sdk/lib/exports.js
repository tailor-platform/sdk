import { bindingNameForCall, isExpressionWrapper } from "./ast.js";

function declaredNames(declaration) {
  if (declaration?.type !== "VariableDeclaration") return [];
  return declaration.declarations.flatMap((entry) =>
    entry.id.type === "Identifier" ? [entry.id.name] : [],
  );
}

export function collectExports(program) {
  const named = new Set();
  const defaults = new Set();

  for (const statement of program.body) {
    if (statement.type === "ExportDefaultDeclaration") {
      if (statement.declaration.type === "Identifier") {
        defaults.add(statement.declaration.name);
      }
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration") continue;
    for (const name of declaredNames(statement.declaration)) {
      named.add(name);
    }
    if (statement.source !== null) continue;
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
