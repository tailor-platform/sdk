import { relative } from "node:path";
/**
 * Require JSDoc on public API exports.
 *
 * Driven by `packages/sdk/scripts/check-public-api-jsdoc.ts`, which walks
 * the entry points declared in `package.json#exports`. Only value-level
 * symbols (functions, classes, enums, variables, methods, accessors) are
 * validated; type aliases and interfaces are excluded.
 */
import { getCombinedModifierFlags } from "typescript/ast";
import { API, ModifierFlags, SymbolFlags } from "typescript/sync";

/**
 * @param {import('typescript/sync').Symbol} symbol - Symbol whose first declaration is resolved
 * @returns {import('typescript/ast').Declaration | undefined} The first declaration node
 */
function firstDeclaration(symbol) {
  return symbol.declarations[0]?.resolve();
}

function getKind(symbol) {
  const f = symbol.flags;
  if (f & SymbolFlags.EnumMember) return "EnumMember";
  if (f & SymbolFlags.Enum) return "Enum";
  if (f & SymbolFlags.Function) return "Function";
  if (f & SymbolFlags.Class) return "Class";
  if (f & SymbolFlags.Method) return "Method";
  if (f & (SymbolFlags.GetAccessor | SymbolFlags.SetAccessor)) return "Accessor";
  if (f & SymbolFlags.Variable) return "Variable";
  return null;
}

function isNonPublicMember(symbol) {
  const decl = firstDeclaration(symbol);
  if (!decl) return false;
  const flags = getCombinedModifierFlags(decl);
  return !!(flags & (ModifierFlags.Private | ModifierFlags.Protected));
}

// TS Compiler API normalizes SourceFile.fileName to forward slashes on all
// platforms, so "/" is the correct separator here.
function isExternal(symbol) {
  const decl = firstDeclaration(symbol);
  if (!decl) return true;
  return decl.getSourceFile().fileName.includes("/node_modules/");
}

/**
 * Walk module exports and invoke `onUndocumented` for each value-level symbol
 * missing JSDoc. Handles alias resolution, class members, and enum members.
 * @param {import('typescript/sync').Checker} checker - TypeScript type checker instance
 * @param {import('typescript/sync').Symbol} mod - Module symbol for the source file
 * @param {(name: string, kind: string, resolved: import('typescript/sync').Symbol) => void} onUndocumented - Callback invoked for each undocumented symbol
 */
function walkUndocumentedExports(checker, mod, onUndocumented) {
  /**
   * @param {import('typescript/sync').Symbol} symbol - The symbol to check for documentation
   * @returns {boolean} Whether the symbol has JSDoc documentation
   */
  function hasDoc(symbol) {
    return (
      symbol.getDocumentationComment(checker).length > 0 || symbol.getJsDocTags(checker).length > 0
    );
  }

  for (const sym of checker.getExportsOfModule(mod)) {
    const resolved = sym.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    const kind = getKind(resolved);

    if (isExternal(resolved)) continue;

    if (kind && !hasDoc(sym) && !hasDoc(resolved)) {
      onUndocumented(sym.name, kind, resolved);
    }

    if (kind === "Class") {
      for (const members of [resolved.getMembers(), resolved.getExports()]) {
        members.forEach((member) => {
          if (member.name === "prototype") return;
          if (isNonPublicMember(member)) return;
          const mk = getKind(member);
          if (mk && !hasDoc(member)) {
            onUndocumented(`${sym.name}.${member.name}`, mk, member);
          }
        });
      }
    }

    if (kind === "Enum") {
      resolved.getExports().forEach((member) => {
        if (!hasDoc(member)) {
          onUndocumented(`${sym.name}.${member.name}`, "EnumMember", member);
        }
      });
    }
  }
}

/**
 * Find undocumented public API symbols in the given entry points.
 * Creates a standalone TypeScript program -- used for testing and CLI.
 * @param {string[]} entryPoints - Absolute paths to entry point source files
 * @param {import('typescript/sync').CompilerOptions} tsCompilerOptions - TypeScript compiler options
 * @param {string} baseDir - Base directory for relative path display
 * @returns {Array<{name: string, kind: string, location: string}>} Undocumented symbol descriptors
 */
export function findUndocumentedSymbols(entryPoints, tsCompilerOptions, baseDir) {
  const api = new API({ cwd: baseDir });
  try {
    const program = api.createProgram(entryPoints, tsCompilerOptions);
    const checker = program.getProject().checker;

    function formatLocation(symbol) {
      const decl = firstDeclaration(symbol);
      if (!decl) return "unknown";
      const sf = decl.getSourceFile();
      const { line } = sf.getLineAndCharacterOfPosition(decl.getStart());
      return `${relative(baseDir, sf.fileName)}:${line + 1}`;
    }

    const failures = [];

    for (const ep of entryPoints) {
      const mod = checker.getSymbolOfSourceFile(ep);
      if (!mod) continue;

      walkUndocumentedExports(checker, mod, (name, kind, resolved) => {
        failures.push({ name, kind, location: formatLocation(resolved) });
      });
    }

    return failures;
  } finally {
    api.close();
  }
}
