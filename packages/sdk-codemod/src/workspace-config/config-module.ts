import * as path from "pathe";
import {
  arrayElements,
  callArgument,
  entryKey,
  findImportStatements,
  importBindings,
  objectEntries,
  pairValue,
} from "../ast-grep-helpers";
import { findDefineConfigCalls } from "../define-config";
import { isTailorConfigPath } from "../plugin-export-bindings";
import { literalText, type ModuleCache, type Report, type SourceModule } from "./project";
import type { SgNode } from "@ast-grep/napi";

export const SDK_MODULE = "@tailor-platform/sdk";

type ServiceKind = "db" | "resolver" | "auth" | "idp";

/** A service a config defines or declares as external. */
export type ServiceRef = {
  service: ServiceKind;
  /** The service's name, or null when it cannot be read from the source. */
  name: string | null;
  external: boolean;
  /** Where to report the service. */
  node: SgNode;
  /** Expression naming the service in an application's list, such as `"main"`, `sharedDb`, or `auth.name`. */
  nameExpression: string | null;
  /** For an Auth service or IdP the config defines: the expression the workspace config keys by name. */
  definitionExpression?: string;
  /** For an Auth service: what its `defineAuth()` call shows, when it can be read. */
  auth?: AuthDefinition;
};

/** What a `defineAuth()` call shows. */
type AuthDefinition = {
  /** Machine user names, or null when `machineUsers` is not an object literal. */
  machineUsers: string[] | null;
  /** Whether it has a `userProfile` and an `idProvider` from a `defineIdp()` IdP (a built-in IdP). */
  builtInIdpUserProfile: boolean;
};

/** One entry of the object passed to `defineConfig()`. */
type ConfigEntry = {
  /** The key, or null for a spread or a computed key. */
  key: string | null;
  node: SgNode;
  /** The value; for a shorthand property, the identifier itself. */
  value: SgNode | null;
};

/** A config whose default export is `defineConfig({ ... })`. */
export type ConfigModule = {
  /** Project-relative path. */
  path: string;
  /** Project-relative directory, `.` for the project directory. */
  dir: string;
  module: SourceModule;
  /** The `defineConfig` call. */
  call: SgNode;
  /** The callee of the call: an identifier or `sdk.defineConfig`. */
  callee: SgNode;
  /** The object literal passed to the call. */
  config: SgNode;
  /** The `export default` statement. */
  exportStatement: SgNode;
  entries: ConfigEntry[];
  /** The application name, or null when it cannot be read. */
  appName: string | null;
  services: ServiceRef[];
};

/** The configs of a project. */
export type ConfigScan = {
  configs: ConfigModule[];
  /** Configs that call `defineConfig()` in a form the codemods cannot convert. */
  unconvertible: Report[];
};

/**
 * Whether a node is a plain identifier reference, including a shorthand property such as `auth` in `{ auth }`.
 * @param node - Node to check
 * @returns Whether it is one
 */
function isIdentifierNode(node: SgNode | null | undefined): node is SgNode {
  return node?.kind() === "identifier" || node?.kind() === "shorthand_property_identifier";
}

function entriesOf(object: SgNode): ConfigEntry[] {
  return objectEntries(object).map((node) => ({
    key: entryKey(node),
    node,
    value: node.kind() === "shorthand_property_identifier" ? node : pairValue(node),
  }));
}

/**
 * The value an identifier is initialized with, at the top level of its module or of the module
 * it is imported from.
 * @param cache - Module cache
 * @param module - Module the identifier appears in
 * @param name - Identifier
 * @returns The initializer and its module, or null
 */
function resolveBinding(
  cache: ModuleCache,
  module: SourceModule,
  name: string,
): { value: SgNode; module: SourceModule } | null {
  const local = topLevelInitializer(module.root, name);
  if (local) return { value: local, module };
  for (const statement of findImportStatements(module.root)) {
    for (const binding of importBindings(statement)) {
      if (binding.localName !== name || binding.importedName === undefined) continue;
      const target = cache.resolve(module.path, binding.source);
      const imported = target === null ? null : cache.get(target);
      if (!imported) return null;
      const value = topLevelInitializer(imported.root, binding.importedName);
      return value ? { value, module: imported } : null;
    }
  }
  return null;
}

function topLevelInitializer(root: SgNode, name: string): SgNode | null {
  for (const statement of root.children()) {
    const declaration =
      statement.kind() === "export_statement"
        ? statement.children().find((child) => child.kind() === "lexical_declaration")
        : statement.kind() === "lexical_declaration"
          ? statement
          : undefined;
    if (!declaration || !declaration.children().some((child) => child.text() === "const")) continue;
    for (const declarator of declaration.children()) {
      if (declarator.kind() !== "variable_declarator") continue;
      const children = declarator.children();
      if (children[0]?.kind() !== "identifier" || children[0].text() !== name) continue;
      const equals = children.findIndex((child) => child.kind() === "=");
      return equals === -1 ? null : (children[equals + 1] ?? null);
    }
  }
  return null;
}

/**
 * Read a string a node evaluates to: a literal, or a `const` initialized with one.
 * @param cache - Module cache
 * @param module - Module the node appears in
 * @param node - Node to read
 * @returns The string, or null
 */
function resolveString(
  cache: ModuleCache,
  module: SourceModule,
  node: SgNode | null,
): string | null {
  const literal = literalText(node);
  if (literal !== null || !node) return literal;
  if (!isIdentifierNode(node)) return null;
  const binding = resolveBinding(cache, module, node.text());
  return binding ? literalText(binding.value) : null;
}

/**
 * The name a call's callee ends with: `f` for `f()` and `a.b.f()`.
 * @param call - The call expression
 * @returns The name, or null for another callee
 */
export function calleeName(call: SgNode): string | null {
  const callee = call.children()[0];
  if (callee?.kind() === "identifier") return callee.text();
  if (callee?.kind() === "member_expression") return callee.children().at(-1)?.text() ?? null;
  return null;
}

/**
 * The arguments of a call.
 * @param call - The call expression
 * @returns Its argument nodes
 */
export function callArguments(call: SgNode): SgNode[] {
  const args = call.children().find((child) => child.kind() === "arguments");
  return args
    ? args.children().filter((child) => !["(", ")", ",", "comment"].includes(String(child.kind())))
    : [];
}

/** A `defineAuth()` or `defineIdp()` call a node evaluates to, with its module. */
function definitionCall(
  cache: ModuleCache,
  module: SourceModule,
  node: SgNode,
  functionName: string,
): { call: SgNode; module: SourceModule } | null {
  if (node.kind() === "call_expression" && calleeName(node) === functionName) {
    return { call: node, module };
  }
  if (!isIdentifierNode(node)) return null;
  const binding = resolveBinding(cache, module, node.text());
  if (!binding) return null;
  return binding.value.kind() === "call_expression" && calleeName(binding.value) === functionName
    ? { call: binding.value, module: binding.module }
    : null;
}

function objectEntryValue(object: SgNode | undefined, key: string): SgNode | null {
  if (object?.kind() !== "object") return null;
  const entry = objectEntries(object).find((candidate) => entryKey(candidate) === key);
  if (!entry) return null;
  return entry.kind() === "shorthand_property_identifier" ? entry : pairValue(entry);
}

function isExternalObject(node: SgNode | null): boolean {
  return objectEntryValue(node ?? undefined, "external")?.text() === "true";
}

function authDefinition(cache: ModuleCache, module: SourceModule, call: SgNode): AuthDefinition {
  const options = callArguments(call)[1];
  const machineUsers = objectEntryValue(options, "machineUsers");
  const idProvider = objectEntryValue(options, "idProvider");
  const providerOwner =
    idProvider?.kind() === "call_expression" && calleeName(idProvider) === "provider"
      ? idProvider.children()[0]?.children()[0]
      : undefined;
  return {
    machineUsers:
      machineUsers?.kind() === "object"
        ? objectEntries(machineUsers).flatMap((entry) => entryKey(entry) ?? [])
        : null,
    builtInIdpUserProfile:
      objectEntryValue(options, "userProfile") !== null &&
      providerOwner !== undefined &&
      definitionCall(cache, module, providerOwner, "defineIdp") !== null,
  };
}

function namespaceRefs(
  cache: ModuleCache,
  module: SourceModule,
  service: "db" | "resolver",
  value: SgNode,
): ServiceRef[] {
  if (value.kind() !== "object") return [];
  return objectEntries(value).flatMap((entry): ServiceRef[] => {
    if (entry.kind() === "shorthand_property_identifier") {
      const name = entry.text();
      return [
        { service, name, external: false, node: entry, nameExpression: JSON.stringify(name) },
      ];
    }
    if (entry.kind() !== "pair") return [];
    const key = entry.children()[0]!;
    const namespaceValue = pairValue(entry);
    let name: string | null;
    let nameExpression: string | null;
    if (key.kind() === "computed_property_name") {
      const expression = key.children().find((child) => !["[", "]"].includes(String(child.kind())));
      name = resolveString(cache, module, expression ?? null);
      nameExpression = expression?.text() ?? null;
    } else {
      name = entryKey(entry);
      nameExpression = name === null ? null : JSON.stringify(name);
    }
    return [
      { service, name, external: isExternalObject(namespaceValue), node: entry, nameExpression },
    ];
  });
}

function authOrIdpRef(
  cache: ModuleCache,
  module: SourceModule,
  service: "auth" | "idp",
  value: SgNode,
  node: SgNode,
): ServiceRef {
  const functionName = service === "auth" ? "defineAuth" : "defineIdp";
  if (value.kind() === "object") {
    const name = resolveString(cache, module, objectEntryValue(value, "name"));
    return {
      service,
      name,
      external: isExternalObject(value),
      node,
      nameExpression: name === null ? null : JSON.stringify(name),
    };
  }
  if (
    service === "auth" &&
    value.kind() === "call_expression" &&
    calleeName(value) === "asExternal"
  ) {
    const owner = value.children()[0]?.children()[0];
    const definition = owner && definitionCall(cache, module, owner, functionName);
    return {
      service,
      name: definition
        ? resolveString(cache, definition.module, callArguments(definition.call)[0] ?? null)
        : null,
      external: true,
      node,
      nameExpression: isIdentifierNode(owner) ? `${owner.text()}.name` : null,
    };
  }
  const definition = definitionCall(cache, module, value, functionName);
  const name = definition
    ? resolveString(cache, definition.module, callArguments(definition.call)[0] ?? null)
    : null;
  const nameExpression = isIdentifierNode(value)
    ? `${value.text()}.name`
    : name === null
      ? null
      : JSON.stringify(name);
  return {
    service,
    name,
    external: false,
    node,
    nameExpression,
    definitionExpression: value.text(),
    ...(service === "auth" && definition
      ? { auth: authDefinition(cache, definition.module, definition.call) }
      : {}),
  };
}

function serviceRefs(
  cache: ModuleCache,
  module: SourceModule,
  entries: ConfigEntry[],
): ServiceRef[] {
  return entries.flatMap((entry): ServiceRef[] => {
    if (!entry.value) return [];
    switch (entry.key) {
      case "db":
      case "resolver":
        return namespaceRefs(cache, module, entry.key, entry.value);
      case "auth":
        return [authOrIdpRef(cache, module, "auth", entry.value, entry.node)];
      case "idp": {
        if (entry.value.kind() !== "array") {
          return [authOrIdpRef(cache, module, "idp", entry.value, entry.node)];
        }
        return arrayElements(entry.value).map((element) =>
          authOrIdpRef(cache, module, "idp", element, element),
        );
      }
      default:
        return [];
    }
  });
}

function defaultExportOf(root: SgNode): { statement: SgNode; value: SgNode } | null {
  for (const statement of root.children()) {
    if (statement.kind() !== "export_statement") continue;
    const children = statement.children();
    if (!children.some((child) => child.kind() === "default")) continue;
    const value = children.find(
      (child) => !["export", "default", ";", "comment"].includes(String(child.kind())),
    );
    return value ? { statement, value } : null;
  }
  return null;
}

/**
 * Read a `defineConfig()` config from source text.
 * @param cache - Module cache of the project, for the modules the config imports
 * @param file - Project-relative path of the config
 * @param source - The config's source text
 * @returns The config, a report when it calls `defineConfig()` in a form that cannot be converted, or null when it does not call it
 */
export function parseConfigModule(
  cache: ModuleCache,
  file: string,
  source: string,
): ConfigModule | Report | null {
  const found = findDefineConfigCalls(source, file);
  if (!found || found.calls.length === 0) return null;
  const module: SourceModule = { path: file, source, root: found.root };
  const exported = defaultExportOf(found.root);
  const call = found.calls.find(
    (candidate) =>
      "config" in candidate &&
      exported?.value.kind() === "call_expression" &&
      callArgument(exported.value)?.range().start.index === candidate.config.range().start.index,
  );
  if (!exported || !call || !("config" in call)) {
    const first = found.calls[0]!;
    return {
      file,
      node: "config" in first ? (first.config.parent()?.parent() ?? first.config) : first.node,
      message:
        "The config is not exported as `export default defineConfig({ ... })`, so it was not converted.",
    };
  }
  const entries = entriesOf(call.config);
  const nameEntry = entries.find((entry) => entry.key === "name");
  return {
    path: file,
    dir: path.dirname(file),
    module,
    call: exported.value,
    callee: exported.value.children()[0]!,
    config: call.config,
    exportStatement: exported.statement,
    entries,
    appName: resolveString(cache, module, nameEntry?.value ?? null),
    services: serviceRefs(cache, module, entries),
  };
}

/**
 * Find the `defineConfig()` configs of a project: its `tailor.config.*` files and the files that
 * scripts, workflows, and the lock name as configs.
 * @param cache - Module cache of the project
 * @param named - Project-relative paths that scripts, workflows, and the lock name as configs
 * @returns The convertible configs and the reports for the others
 */
export function scanConfigs(cache: ModuleCache, named: readonly string[] = []): ConfigScan {
  const scan: ConfigScan = { configs: [], unconvertible: [] };
  const paths = new Set(cache.project.paths);
  const candidates = new Set([
    ...cache.project.paths.filter((file) => isTailorConfigPath(file)),
    ...named.filter((file) => paths.has(file)),
  ]);
  for (const file of [...candidates].toSorted()) {
    const source = cache.project.read(file);
    if (source === undefined) continue;
    const config = parseConfigModule(cache, file, source);
    if (config === null) continue;
    if ("message" in config) scan.unconvertible.push(config);
    else scan.configs.push(config);
  }
  return scan;
}
