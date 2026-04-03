import { parseTS } from "../../../../src/helpers";
import type { Edit, SgNode } from "@ast-grep/napi";

/**
 * Known plugin mappings from package name to plugin function/import.
 */
const PLUGIN_MAP: Record<string, { functionName: string; importPath: string }> = {
  "@tailor-platform/kysely-type": {
    functionName: "kyselyTypePlugin",
    importPath: "@tailor-platform/sdk/plugin/kysely-type",
  },
  "@tailor-platform/seed": {
    functionName: "seedPlugin",
    importPath: "@tailor-platform/sdk/plugin/seed",
  },
  "@tailor-platform/enum-constants": {
    functionName: "enumConstantsPlugin",
    importPath: "@tailor-platform/sdk/plugin/enum-constants",
  },
  "@tailor-platform/file-utils": {
    functionName: "fileUtilsPlugin",
    importPath: "@tailor-platform/sdk/plugin/file-utils",
  },
};

/**
 * Transform defineGenerators() to definePlugins():
 *
 * 1. Rename `defineGenerators` → `definePlugins` in import and call
 * 2. Transform tuple arguments `["pkg-name", config]` → `pluginFn(config)`
 * 3. Add plugin imports from their respective SDK paths
 * 4. Rename `generators` variable → `plugins`
 * @param source - Source code to transform
 * @returns Transformed source or null if no changes needed
 */
export default function transform(source: string): string | null {
  const tree = parseTS(source).root();

  // Check if this file uses defineGenerators
  if (!source.includes("defineGenerators")) {
    return null;
  }

  const edits: Edit[] = [];
  const importsToAdd: Map<string, string> = new Map(); // importPath -> functionName

  // Step 1: Find and transform defineGenerators call arguments (tuples → plugin calls)
  const callNodes = tree.findAll({
    rule: {
      pattern: "defineGenerators($$$ARGS)",
    },
  });

  for (const callNode of callNodes) {
    // Find array/tuple arguments inside the call
    const args = callNode.getMultipleMatches("ARGS");
    for (const arg of args) {
      // Match tuple pattern: ["package-name", config]
      if (arg.kind() === "array") {
        const children = arg
          .children()
          .filter((c: SgNode) => c.isNamed() && c.kind() !== "comment");
        if (children.length >= 1) {
          const packageNameNode = children[0]!;
          const packageName = packageNameNode.text().replace(/^["']|["']$/g, "");
          const mapping = PLUGIN_MAP[packageName];

          if (mapping) {
            importsToAdd.set(mapping.importPath, mapping.functionName);
            // Build replacement: pluginFn(config) or pluginFn() if no config
            const configNodes = children.slice(1);
            const configText =
              configNodes.length > 0 ? configNodes.map((c: SgNode) => c.text()).join(", ") : "";
            const replacement = `${mapping.functionName}(${configText})`;
            edits.push(arg.replace(replacement));
          }
        }
      }
    }
  }

  // Step 2: Rename defineGenerators → definePlugins in the call expression
  const identifiers = tree.findAll({
    rule: {
      pattern: "defineGenerators",
      kind: "identifier",
    },
  });

  for (const id of identifiers) {
    edits.push(id.replace("definePlugins"));
  }

  // Step 3: Rename `generators` variable to `plugins` (only the export binding)
  const generatorsDecls = tree.findAll({
    rule: {
      kind: "variable_declarator",
      has: {
        kind: "identifier",
        regex: "^generators$",
        field: "name",
      },
    },
  });

  for (const decl of generatorsDecls) {
    const nameNode = decl.field("name");
    if (nameNode && nameNode.text() === "generators") {
      edits.push(nameNode.replace("plugins"));
    }
  }

  // Step 4: Rename import specifier defineGenerators → definePlugins
  const importSpecifiers = tree.findAll({
    rule: {
      kind: "import_specifier",
      has: {
        kind: "identifier",
        regex: "^defineGenerators$",
      },
      inside: {
        kind: "import_statement",
        has: {
          kind: "string",
          regex: "@tailor-platform/sdk",
        },
      },
    },
  });

  for (const spec of importSpecifiers) {
    const identNode = spec
      .children()
      .find((c: SgNode) => c.kind() === "identifier" && c.text() === "defineGenerators");
    if (identNode) {
      edits.push(identNode.replace("definePlugins"));
    }
  }

  if (edits.length === 0) {
    return null;
  }

  // Apply all edits
  let result = tree.commitEdits(edits);

  // Step 5: Add new import statements for plugin functions
  if (importsToAdd.size > 0) {
    const importLines: string[] = [];
    for (const [importPath, functionName] of importsToAdd) {
      importLines.push(`import { ${functionName} } from "${importPath}";`);
    }
    // Sort for deterministic output
    importLines.sort();

    // Find insertion point: after the @tailor-platform/sdk import line
    const sdkImportRegex = /^(import\s+.*from\s+["']@tailor-platform\/sdk["'];?)$/m;
    const match = sdkImportRegex.exec(result);
    if (match) {
      const insertPos = (match.index ?? 0) + match[0].length;
      result = result.slice(0, insertPos) + "\n" + importLines.join("\n") + result.slice(insertPos);
    } else {
      // Fallback: prepend imports at the top of the file
      result = importLines.join("\n") + "\n" + result;
    }
  }

  return result;
}
