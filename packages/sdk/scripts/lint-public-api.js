/**
 * Validate that public API symbols have JSDoc documentation.
 *
 * Uses the TypeScript Compiler API to resolve exports from entry points
 * derived from package.json#exports, and verifies that value symbols
 * (functions, classes, enums, variables, methods, accessors) are documented.
 */
import ts from "typescript";
import { readFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Only value-level symbols are checked, matching the scope of the former
// jsdoc/require-jsdoc ESLint rule. Type aliases and interfaces are excluded.
// getKind returns null for anything not in scope, so a truthy check suffices.
function getKind(symbol) {
  const f = symbol.flags;
  if (f & ts.SymbolFlags.EnumMember) return "EnumMember";
  if (f & ts.SymbolFlags.Enum) return "Enum";
  if (f & ts.SymbolFlags.Function) return "Function";
  if (f & ts.SymbolFlags.Class) return "Class";
  if (f & ts.SymbolFlags.Method) return "Method";
  if (f & ts.SymbolFlags.GetAccessor || f & ts.SymbolFlags.SetAccessor) return "Accessor";
  if (f & ts.SymbolFlags.Variable) return "Variable";
  return null;
}

/**
 * Find undocumented public API symbols in the given entry points.
 * @param entryPoints - Absolute paths to entry point source files
 * @param tsCompilerOptions - TypeScript compiler options
 * @param baseDir - Base directory for relative path display
 * @returns Array of undocumented symbol descriptors
 */
export function findUndocumentedSymbols(entryPoints, tsCompilerOptions, baseDir) {
  const program = ts.createProgram(entryPoints, tsCompilerOptions);
  const checker = program.getTypeChecker();

  function hasDoc(symbol) {
    return (
      symbol.getDocumentationComment(checker).length > 0 || symbol.getJsDocTags(checker).length > 0
    );
  }

  // TS Compiler API normalizes SourceFile.fileName to forward slashes on all
  // platforms, so "/" is the correct separator here.
  function isExternal(symbol) {
    const decls = symbol.getDeclarations();
    if (!decls?.length) return true;
    return decls[0].getSourceFile().fileName.includes("/node_modules/");
  }

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

    for (const sym of checker.getExportsOfModule(mod)) {
      const resolved = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
      const kind = getKind(resolved);

      if (isExternal(resolved)) continue;

      if (kind && !hasDoc(sym) && !hasDoc(resolved)) {
        failures.push({ name: sym.getName(), kind, location: formatLocation(resolved) });
      }

      if (kind === "Class") {
        for (const members of [resolved.members, resolved.exports]) {
          members?.forEach((member) => {
            if (member.getName() === "prototype") return;
            const mk = getKind(member);
            if (mk && !hasDoc(member)) {
              failures.push({
                name: `${sym.getName()}.${member.getName()}`,
                kind: mk,
                location: formatLocation(member),
              });
            }
          });
        }
      }

      if (kind === "Enum") {
        resolved.exports?.forEach((member) => {
          if (!hasDoc(member)) {
            failures.push({
              name: `${sym.getName()}.${member.getName()}`,
              kind: "EnumMember",
              location: formatLocation(member),
            });
          }
        });
      }
    }
  }

  return failures;
}

// CLI entry point
const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const pkg = JSON.parse(readFileSync(resolve(sdkRoot, "package.json"), "utf8"));
  const entryPoints = Object.values(pkg.exports)
    .map((exp) => exp.types)
    .filter(Boolean)
    .map((p) => resolve(sdkRoot, p.replace(/^\.\/dist\//, "./src/").replace(/\.d\.mts$/, ".ts")));

  const tsConfigPath = resolve(sdkRoot, "tsconfig.json");
  const { config } = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, sdkRoot);

  const failures = findUndocumentedSymbols(entryPoints, options, sdkRoot);

  if (failures.length > 0) {
    console.error(`Found ${failures.length} public API symbols without documentation:\n`);
    for (const { name, kind, location } of failures) {
      console.error(`  ${name} (${kind}) at ${location}`);
    }
    process.exit(1);
  }

  console.log("All public API symbols are documented.");
}
