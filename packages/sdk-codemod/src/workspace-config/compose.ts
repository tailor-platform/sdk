import * as path from "pathe";
import {
  arrayElements,
  entryKey,
  findImportStatements,
  importSource,
  importSpecNames,
  isInsideImportStatement,
  pairValue,
  parseRoot,
} from "../ast-grep-helpers";
import { callArguments, parseConfigModule, SDK_MODULE, type ConfigModule } from "./config-module";
import { literalText, relativeSpecifier, type ModuleCache, type Report } from "./project";
import { applyEdits, rebasePattern, replaceNode, type TextEdit } from "./text";
import type { SgNode } from "@ast-grep/napi";

/** A top-level name of a member, and what it refers to. */
type Binding = {
  name: string;
  /** Identifies what the name refers to, so that two members importing the same thing share it. */
  meaning: string;
  exported: boolean;
  node: SgNode;
};

/** An import of a merged member, with its source rewritten for the workspace config. */
type ImportedName = {
  source: string;
  kind: "named" | "default" | "namespace";
  imported?: string;
  local: string;
  typeOnly: boolean;
};

/** The members merged into one module, before the workspace config object is added. */
export type ComposedModule = {
  /** The members re-read from their renamed source. */
  members: ConfigModule[];
  imports: ImportedName[];
  /** Side-effect imports, by rewritten source. */
  sideEffects: string[];
  /** Top-level statements other than imports and the exports the merge replaces, by member. */
  statements: string[][];
  /** Plugin expressions, or null when no member exports plugins. */
  plugins: string[] | null;
  /** The text of the single member's plugins export, kept as written when only one member has one. */
  pluginsStatement: string | null;
  findings: Report[];
  stops: Report[];
};

const DECLARATION_KINDS: ReadonlySet<string> = new Set([
  "function_declaration",
  "generator_function_declaration",
  "class_declaration",
  "abstract_class_declaration",
  "type_alias_declaration",
  "interface_declaration",
  "enum_declaration",
]);

function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function camelCase(name: string): string {
  return name.replace(/[^A-Za-z0-9]+(.)?/gu, (_, next: string | undefined) =>
    next ? next.toUpperCase() : "",
  );
}

function declarationOf(statement: SgNode): { declaration: SgNode; exported: boolean } | null {
  if (statement.kind() === "export_statement") {
    if (statement.children().some((child) => child.kind() === "default")) return null;
    const declaration = statement
      .children()
      .find(
        (child) =>
          child.kind() === "lexical_declaration" ||
          child.kind() === "variable_declaration" ||
          DECLARATION_KINDS.has(String(child.kind())),
      );
    return declaration ? { declaration, exported: true } : null;
  }
  if (
    statement.kind() === "lexical_declaration" ||
    statement.kind() === "variable_declaration" ||
    DECLARATION_KINDS.has(String(statement.kind()))
  ) {
    return { declaration: statement, exported: false };
  }
  return null;
}

function declaredNames(declaration: SgNode): Array<{ name: string; node: SgNode }> | null {
  if (
    declaration.kind() === "lexical_declaration" ||
    declaration.kind() === "variable_declaration"
  ) {
    const names: Array<{ name: string; node: SgNode }> = [];
    for (const declarator of declaration.children()) {
      if (declarator.kind() !== "variable_declarator") continue;
      const binding = declarator.children()[0];
      if (binding?.kind() !== "identifier") return null;
      names.push({ name: binding.text(), node: binding });
    }
    return names;
  }
  const name = declaration
    .children()
    .find((child) => child.kind() === "identifier" || child.kind() === "type_identifier");
  return name ? [{ name: name.text(), node: name }] : [];
}

function isPluginsExport(statement: SgNode): SgNode | null {
  const found = declarationOf(statement);
  if (!found?.exported || found.declaration.kind() !== "lexical_declaration") return null;
  const declarator = found.declaration
    .children()
    .find((child) => child.kind() === "variable_declarator");
  if (declarator?.children()[0]?.text() !== "plugins") return null;
  const children = declarator.children();
  return children[children.findIndex((child) => child.kind() === "=") + 1] ?? null;
}

/** Whether a name is declared again in a scope nested in the module, which a rename could not tell apart. */
function isShadowed(root: SgNode, name: string, topLevel: ReadonlySet<number>): boolean {
  for (const node of root.findAll({
    rule: { any: [{ kind: "identifier" }, { kind: "shorthand_property_identifier_pattern" }] },
  })) {
    if (node.text() !== name || topLevel.has(node.range().start.index)) continue;
    const parent = node.parent();
    const kind = String(parent?.kind());
    if (
      node.kind() === "shorthand_property_identifier_pattern" ||
      kind === "variable_declarator" ||
      kind === "required_parameter" ||
      kind === "optional_parameter" ||
      kind === "formal_parameters" ||
      kind === "arrow_function" ||
      kind === "catch_clause" ||
      kind === "function_declaration" ||
      kind === "class_declaration" ||
      kind === "pair_pattern" ||
      kind === "array_pattern"
    ) {
      if (
        kind === "variable_declarator" &&
        parent?.children()[0]?.range().start.index !== node.range().start.index
      )
        continue;
      if (
        kind === "arrow_function" &&
        parent?.children()[0]?.range().start.index !== node.range().start.index
      )
        continue;
      return true;
    }
  }
  return false;
}

function renameEdits(root: SgNode, renames: ReadonlyMap<string, string>): TextEdit[] {
  const edits: TextEdit[] = [];
  for (const node of root.findAll({
    rule: {
      any: [
        { kind: "identifier" },
        { kind: "type_identifier" },
        { kind: "shorthand_property_identifier" },
      ],
    },
  })) {
    const renamed = renames.get(node.text());
    if (renamed === undefined) continue;
    if (isInsideImportStatement(node)) continue;
    edits.push(
      replaceNode(
        node,
        node.kind() === "shorthand_property_identifier" ? `${node.text()}: ${renamed}` : renamed,
      ),
    );
  }
  return edits;
}

function pluginExpressions(value: SgNode): string[] | null {
  if (value.kind() === "array") return arrayElements(value).map((element) => element.text());
  if (value.kind() !== "call_expression" || value.children()[0]?.text() !== "definePlugins")
    return null;
  return callArguments(value).map((child) => child.text());
}

/**
 * Edits that rewrite the relative `distPath` of plugins so that it names the same directory from
 * `toDir`, and reports for other relative paths passed to plugins.
 */
function pluginPathEdits(
  member: ConfigModule,
  value: SgNode,
  toDir: string,
  findings: Report[],
): TextEdit[] {
  if (member.dir === toDir) return [];
  const edits: TextEdit[] = [];
  for (const node of value.findAll({
    rule: { any: [{ kind: "string" }, { kind: "template_string" }] },
  })) {
    const text = literalText(node);
    if (text === null || !/^\.\.?\//u.test(text)) continue;
    const pair = node.parent();
    if (
      pair?.kind() === "pair" &&
      entryKey(pair) === "distPath" &&
      pairValue(pair)?.range().start.index === node.range().start.index
    ) {
      const quote = node.text()[0]!;
      edits.push(replaceNode(node, `${quote}${rebasePattern(text, member.dir, toDir)}${quote}`));
      continue;
    }
    findings.push({
      file: member.path,
      node,
      message: `This plugin option is a path relative to ${member.dir}; check it against the workspace config's directory.`,
    });
  }
  return edits;
}

/**
 * Merge the members' modules: give every top-level name one meaning, renaming the names two
 * members declare differently, rewrite relative imports for the workspace config's location, and
 * drop the imports between members.
 * @param cache - Module cache of the project
 * @param members - The configs to merge, owners of shared services first
 * @param outputPath - Project-relative path of the workspace config
 * @returns The merged module parts
 */
export function composeMembers(
  cache: ModuleCache,
  members: readonly ConfigModule[],
  outputPath: string,
): ComposedModule {
  const outputDir = path.dirname(outputPath);
  const memberPaths = new Set(members.map((member) => member.path));
  const composed: ComposedModule = {
    members: [],
    imports: [],
    sideEffects: [],
    statements: [],
    plugins: null,
    pluginsStatement: null,
    findings: [],
    stops: [],
  };
  const finalByMeaning = new Map<string, string>([
    [`import:${SDK_MODULE}:defineWorkspace`, "defineWorkspace"],
  ]);
  const taken = new Set<string>(["defineWorkspace", "plugins"]);
  const assign = (binding: Binding, prefix: string): string => {
    const existing = finalByMeaning.get(binding.meaning);
    if (existing !== undefined) return existing;
    let name = binding.name;
    if (taken.has(name)) {
      const base = `${camelCase(prefix)}${capitalize(binding.name)}`;
      name = base;
      for (let suffix = 2; taken.has(name); suffix += 1) name = `${base}${suffix}`;
    }
    taken.add(name);
    finalByMeaning.set(binding.meaning, name);
    return name;
  };

  const bindingsByMember = members.map((member) => {
    const bindings: Binding[] = [];
    for (const statement of findImportStatements(member.module.root)) {
      const source = importSource(statement);
      if (source === null) continue;
      const resolved = cache.resolve(member.path, source);
      for (const named of importedNames(statement)) {
        const target = resolved ?? source;
        if (resolved !== null && memberPaths.has(resolved)) {
          if (named.kind !== "named") {
            composed.stops.push({
              file: member.path,
              node: statement,
              message:
                "The config imports another config's default export or namespace, which the merge replaces.",
            });
            continue;
          }
          bindings.push({
            name: named.local,
            meaning: `decl:${resolved}:${named.imported}`,
            exported: false,
            node: statement,
          });
          continue;
        }
        if (source === SDK_MODULE && named.imported === "defineConfig") continue;
        bindings.push({
          name: named.local,
          meaning: `import:${target}:${named.kind}:${named.imported ?? ""}:${named.typeOnly}`,
          exported: false,
          node: statement,
        });
      }
    }
    for (const statement of member.module.root.children()) {
      if (isPluginsExport(statement)) continue;
      const found = declarationOf(statement);
      if (!found) continue;
      const names = declaredNames(found.declaration);
      if (names === null) {
        composed.stops.push({
          file: member.path,
          node: statement,
          message: "A destructuring declaration at the top level of the config cannot be merged.",
        });
        continue;
      }
      for (const { name, node } of names) {
        bindings.push({
          name,
          meaning: `decl:${member.path}:${name}`,
          exported: found.exported,
          node,
        });
      }
    }
    return bindings;
  });

  const pluginStatements: string[] = [];
  members.forEach((member, index) => {
    const renames = new Map<string, string>();
    const topLevel = new Set(
      bindingsByMember[index]!.map((binding) => binding.node.range().start.index),
    );
    for (const binding of bindingsByMember[index]!) {
      const final = assign(binding, member.appName ?? path.basename(member.dir));
      if (final === binding.name) continue;
      if (binding.exported) {
        composed.stops.push({
          file: member.path,
          node: binding.node,
          message: `The exported name ${binding.name} clashes with a name another config declares.`,
        });
        continue;
      }
      if (isShadowed(member.module.root, binding.name, topLevel)) {
        composed.stops.push({
          file: member.path,
          node: binding.node,
          message: `${binding.name} clashes with a name another config declares, and a nested scope declares it again, so it cannot be renamed.`,
        });
        continue;
      }
      renames.set(binding.name, final);
    }
    const source = applyEdits(member.module.source, renameEdits(member.module.root, renames));
    const renamed = parseConfigModule(cache, member.path, source);
    if (renamed === null || "message" in renamed) {
      composed.stops.push({
        file: member.path,
        node: member.call,
        message: "The config could not be read again after renaming its declarations.",
      });
      return;
    }
    composed.members.push(renamed);

    for (const statement of findImportStatements(renamed.module.root)) {
      const importPath = importSource(statement);
      if (importPath === null) continue;
      const resolved = cache.resolve(member.path, importPath);
      if (resolved !== null && memberPaths.has(resolved)) continue;
      const rewritten = importPath.startsWith(".")
        ? relativeSpecifier(outputPath, path.join(member.dir, importPath))
        : importPath;
      const names = importedNames(statement);
      if (names.length === 0) {
        if (!composed.sideEffects.includes(rewritten)) composed.sideEffects.push(rewritten);
        continue;
      }
      for (const named of names) {
        if (importPath === SDK_MODULE && named.imported === "defineConfig") continue;
        const local = renames.get(named.local) ?? named.local;
        if (
          !composed.imports.some(
            (existing) => existing.source === rewritten && existing.local === local,
          )
        ) {
          composed.imports.push({ ...named, source: rewritten, local });
        }
      }
    }

    const statements: string[] = [];
    let previousEnd: number | null = null;
    for (const statement of renamed.module.root.children()) {
      const kind = String(statement.kind());
      if (
        kind === "import_statement" ||
        statement.range().start.index === renamed.exportStatement.range().start.index
      ) {
        previousEnd = statement.range().end.index;
        continue;
      }
      const plugins = isPluginsExport(statement);
      if (plugins) {
        const edits = pluginPathEdits(renamed, plugins, outputDir, composed.findings);
        const expressions = pluginExpressions(plugins);
        if (expressions === null) {
          composed.stops.push({
            file: member.path,
            node: statement,
            message:
              "`plugins` is not a definePlugins() call or an array literal, so it cannot be merged.",
          });
        } else {
          const edited = parseExpression(
            applyEdits(plugins.text(), edits, plugins.range().start.index),
          );
          composed.plugins = [
            ...(composed.plugins ?? []),
            ...((edited && pluginExpressions(edited)) ?? expressions),
          ];
          pluginStatements.push(applyEdits(statement.text(), edits, statement.range().start.index));
        }
        previousEnd = statement.range().end.index;
        continue;
      }
      const gap =
        previousEnd === null
          ? ""
          : renamed.module.source.slice(previousEnd, statement.range().start.index);
      if (statements.length > 0 && /\n[ \t]*\n/u.test(gap)) statements.push("");
      const reexported =
        statement.kind() === "export_statement"
          ? statement.children().find((child) => child.kind() === "string")
          : undefined;
      const reexportPath = literalText(reexported);
      if (reexported && reexportPath !== null && reexportPath.startsWith(".")) {
        if (memberPaths.has(cache.resolve(member.path, reexportPath) ?? "")) {
          composed.stops.push({
            file: member.path,
            node: statement,
            message:
              "The config re-exports another config's exports, which the merge puts in one module.",
          });
        }
        const quote = reexported.text()[0];
        const rewritten = relativeSpecifier(outputPath, path.join(member.dir, reexportPath));
        statements.push(
          applyEdits(
            statement.text(),
            [replaceNode(reexported, `${quote}${rewritten}${quote}`)],
            statement.range().start.index,
          ),
        );
      } else {
        statements.push(statement.text());
      }
      previousEnd = statement.range().end.index;
      for (const relativeUse of statement.findAll({
        rule: {
          any: [{ pattern: "import.meta" }, { pattern: "__dirname" }, { pattern: "__filename" }],
        },
      })) {
        composed.findings.push({
          file: member.path,
          node: relativeUse,
          message: `This code ran in ${member.dir} and now runs in ${outputDir}; check paths built from it.`,
        });
      }
    }
    composed.statements.push(statements);
  });
  composed.pluginsStatement = pluginStatements.length === 1 ? pluginStatements[0]! : null;
  return composed;
}

function parseExpression(expression: string): SgNode | null {
  const root = parseRoot(`(${expression});`, "plugins.ts");
  const statement = root?.children().find((child) => child.kind() === "expression_statement");
  const parenthesized = statement?.children()[0];
  return parenthesized?.kind() === "parenthesized_expression"
    ? (parenthesized.children()[1] ?? null)
    : null;
}

function importedNames(statement: SgNode): Array<Omit<ImportedName, "source">> {
  const typeOnly = statement.children().some((child) => child.kind() === "type");
  const clause = statement.children().find((child) => child.kind() === "import_clause");
  if (!clause) return [];
  const names: Array<Omit<ImportedName, "source">> = [];
  for (const child of clause.children()) {
    if (child.kind() === "identifier")
      names.push({ kind: "default", local: child.text(), typeOnly });
    else if (child.kind() === "namespace_import") {
      const local = child.children().find((grandchild) => grandchild.kind() === "identifier");
      if (local) names.push({ kind: "namespace", local: local.text(), typeOnly });
    } else if (child.kind() === "named_imports") {
      for (const specifier of child.findAll({ rule: { kind: "import_specifier" } })) {
        const spec = importSpecNames(specifier);
        if (!spec) continue;
        names.push({
          kind: "named",
          imported: spec.importedName,
          local: spec.localName,
          typeOnly: typeOnly || spec.typeOnly,
        });
      }
    }
  }
  return names;
}

/**
 * Render the import statements of the merged module, the SDK's first.
 * @param composed - The merged module parts
 * @param extraSdkNames - SDK names the workspace config needs besides the members' imports
 * @returns The import statements
 */
export function renderImports(
  composed: ComposedModule,
  extraSdkNames: readonly string[],
): string[] {
  const bySource = new Map<string, ImportedName[]>();
  const sdkNames: ImportedName[] = [];
  for (const named of composed.imports) {
    if (named.source === SDK_MODULE && named.kind === "named" && !named.typeOnly) {
      sdkNames.push(named);
      continue;
    }
    bySource.set(named.source, [...(bySource.get(named.source) ?? []), named]);
  }
  const lines: string[] = [];
  const specifier = (named: ImportedName) =>
    `${named.typeOnly ? "type " : ""}${named.imported === named.local ? named.local : `${named.imported} as ${named.local}`}`;
  const sdk = [...sdkNames];
  const defineConfigIndex = composed.members[0]
    ? findImportStatements(composed.members[0].module.root)
        .filter((statement) => importSource(statement) === SDK_MODULE)
        .flatMap((statement) => importedNames(statement))
        .filter((named) => named.kind === "named" && !named.typeOnly)
        .findIndex((named) => named.imported === "defineConfig")
    : -1;
  for (const name of extraSdkNames) {
    if (sdk.some((named) => named.local === name)) continue;
    const entry: ImportedName = {
      source: SDK_MODULE,
      kind: "named",
      imported: name,
      local: name,
      typeOnly: false,
    };
    if (name === "defineWorkspace" && defineConfigIndex >= 0)
      sdk.splice(Math.min(defineConfigIndex, sdk.length), 0, entry);
    else sdk.push(entry);
  }
  lines.push(`import { ${sdk.map(specifier).join(", ")} } from "${SDK_MODULE}";`);
  for (const [source, names] of bySource) {
    const defaults = names.filter((named) => named.kind === "default");
    const namespaces = names.filter((named) => named.kind === "namespace");
    const named = names.filter((entry) => entry.kind === "named");
    for (const namespace of namespaces)
      lines.push(`import * as ${namespace.local} from "${source}";`);
    const head = defaults.map((entry) => entry.local).join(", ");
    if (head === "" && named.length === 0) continue;
    const braces = named.length > 0 ? `{ ${named.map(specifier).join(", ")} }` : "";
    lines.push(
      `import ${[head, braces].filter((part) => part !== "").join(", ")} from "${source}";`,
    );
  }
  for (const source of composed.sideEffects) lines.push(`import "${source}";`);
  return lines;
}
