import { relative } from "node:path";
/**
 * ESLint rule: require JSDoc on public API exports.
 *
 * Applied to entry point files via the `files` property in eslint.config.js.
 * Only value-level symbols (functions, classes, enums, variables, methods,
 * accessors) are validated; type aliases and interfaces are excluded.
 */
import ts from "typescript";

function getKind(symbol) {
  const f = symbol.flags;
  if (f & ts.SymbolFlags.EnumMember) return "EnumMember";
  if (f & ts.SymbolFlags.Enum) return "Enum";
  if (f & ts.SymbolFlags.Function) return "Function";
  if (f & ts.SymbolFlags.Class) return "Class";
  if (f & ts.SymbolFlags.Method) return "Method";
  if (f & (ts.SymbolFlags.GetAccessor | ts.SymbolFlags.SetAccessor)) return "Accessor";
  if (f & ts.SymbolFlags.Variable) return "Variable";
  return null;
}

function isNonPublicMember(symbol) {
  const decls = symbol.getDeclarations();
  if (!decls?.length) return false;
  const flags = ts.getCombinedModifierFlags(decls[0]);
  return !!(flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected));
}

// TS Compiler API normalizes SourceFile.fileName to forward slashes on all
// platforms, so "/" is the correct separator here.
function isExternal(symbol) {
  const decls = symbol.getDeclarations();
  if (!decls?.length) return true;
  return decls[0].getSourceFile().fileName.includes("/node_modules/");
}

/**
 * Walk module exports and invoke `onUndocumented` for each value-level symbol
 * missing JSDoc. Handles alias resolution, class members, and enum members.
 * @param {import('typescript').TypeChecker} checker - TypeScript type checker instance
 * @param {import('typescript').Symbol} mod - Module symbol for the source file
 * @param {(name: string, kind: string, resolved: import('typescript').Symbol) => void} onUndocumented - Callback invoked for each undocumented symbol
 */
function walkUndocumentedExports(checker, mod, onUndocumented) {
  /**
   * @param {import('typescript').Symbol} symbol - The symbol to check for documentation
   * @returns {boolean} Whether the symbol has JSDoc documentation
   */
  function hasDoc(symbol) {
    return (
      symbol.getDocumentationComment(checker).length > 0 || symbol.getJsDocTags(checker).length > 0
    );
  }

  for (const sym of checker.getExportsOfModule(mod)) {
    const resolved = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    const kind = getKind(resolved);

    if (isExternal(resolved)) continue;

    if (kind && !hasDoc(sym) && !hasDoc(resolved)) {
      onUndocumented(sym.getName(), kind, resolved);
    }

    if (kind === "Class") {
      for (const members of [resolved.members, resolved.exports]) {
        members?.forEach((member) => {
          if (member.getName() === "prototype") return;
          if (isNonPublicMember(member)) return;
          const mk = getKind(member);
          if (mk && !hasDoc(member)) {
            onUndocumented(`${sym.getName()}.${member.getName()}`, mk, member);
          }
        });
      }
    }

    if (kind === "Enum") {
      resolved.exports?.forEach((member) => {
        if (!hasDoc(member)) {
          onUndocumented(`${sym.getName()}.${member.getName()}`, "EnumMember", member);
        }
      });
    }
  }
}

/**
 * Find undocumented public API symbols in the given entry points.
 * Creates a standalone TypeScript program -- used for testing and CLI.
 * @param {string[]} entryPoints - Absolute paths to entry point source files
 * @param {import('typescript').CompilerOptions} tsCompilerOptions - TypeScript compiler options
 * @param {string} baseDir - Base directory for relative path display
 * @returns {Array<{name: string, kind: string, location: string}>} Undocumented symbol descriptors
 */
export function findUndocumentedSymbols(entryPoints, tsCompilerOptions, baseDir) {
  const program = ts.createProgram(entryPoints, tsCompilerOptions);
  const checker = program.getTypeChecker();

  function formatLocation(symbol) {
    const decls = symbol.getDeclarations();
    if (!decls?.length) return "unknown";
    const sf = decls[0].getSourceFile();
    const { line } = sf.getLineAndCharacterOfPosition(decls[0].getStart());
    return `${relative(baseDir, sf.fileName)}:${line + 1}`;
  }

  const failures = [];

  for (const ep of entryPoints) {
    const sf = program.getSourceFile(ep);
    if (!sf) continue;
    const mod = checker.getSymbolAtLocation(sf);
    if (!mod) continue;

    walkUndocumentedExports(checker, mod, (name, kind, resolved) => {
      failures.push({ name, kind, location: formatLocation(resolved) });
    });
  }

  return failures;
}
