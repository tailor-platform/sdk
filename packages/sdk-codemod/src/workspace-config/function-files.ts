import * as path from "pathe";
import picomatch from "picomatch";
import {
  arrayElements,
  entryKey,
  hasDynamicKey,
  objectEntries,
  pairValue,
} from "../ast-grep-helpers";
import { SOURCE_EXTENSIONS } from "../walk-files";
import {
  callArguments,
  calleeName,
  entryValue,
  resolveString,
  evaluatesToObject,
  withTypeOperators,
  withoutTypeOperators,
  type ConfigModule,
} from "./config-module";
import { literalText, type ModuleCache, type Report, type SourceModule } from "./project";
import { machineUserAmbiguity, type GroupFacts } from "./sections";
import { addProperty, applyEdits, replaceNode, type TextEdit } from "./text";
import type { SgNode } from "@ast-grep/napi";

const IDP_TRIGGERS: ReadonlySet<string> = new Set([
  "idpUserCreatedTrigger",
  "idpUserUpdatedTrigger",
  "idpUserDeletedTrigger",
  "idpUserTrigger",
]);
const AUTH_TRIGGERS: ReadonlySet<string> = new Set([
  "authAccessTokenIssuedTrigger",
  "authAccessTokenRefreshedTrigger",
  "authAccessTokenRevokedTrigger",
  "authAccessTokenTrigger",
]);
const OPERATION_KINDS_WITH_INVOKER: ReadonlySet<string> = new Set([
  "function",
  "jobFunction",
  "graphql",
  "workflow",
]);

/** The service an executor trigger names, which a merge with several of them makes it name. */
type TriggerService = {
  calls: ReadonlySet<string>;
  option: "idp" | "auth";
  singular: string;
  plural: string;
  count: (facts: GroupFacts) => number;
  service: (context: MemberContext) => string | null;
};

const TRIGGER_SERVICES: readonly TriggerService[] = [
  {
    calls: IDP_TRIGGERS,
    option: "idp",
    singular: "IdP",
    plural: "IdPs",
    count: (facts) => facts.idpCount,
    service: (context) => context.idpName,
  },
  {
    calls: AUTH_TRIGGERS,
    option: "auth",
    singular: "Auth service",
    plural: "Auth services",
    count: (facts) => facts.authCount,
    service: (context) => context.authName,
  },
];

/** What a merged config's functions relied on its config for. */
export type MemberContext = {
  member: ConfigModule;
  /** The Auth service the config used, its own or an external one. */
  authName: string | null;
  /** The first IdP the config listed. */
  idpName: string | null;
};

type FilesPatterns = { patterns: string[]; ignores: string[] };

function patternsOf(service: SgNode | null): FilesPatterns {
  const result: FilesPatterns = { patterns: [], ignores: [] };
  if (service?.kind() !== "object") return result;
  for (const entry of objectEntries(service)) {
    const key = entryKey(entry);
    const value = entry.kind() === "pair" ? pairValue(entry) : null;
    if (value?.kind() !== "array") continue;
    const literals = arrayElements(value).flatMap((element) => literalText(element) ?? []);
    if (key === "files" || key === "job_files") result.patterns.push(...literals);
    else if (key === "ignores" || key === "job_ignores") result.ignores.push(...literals);
  }
  return result;
}

function servicesOf(
  member: ConfigModule,
  keys: readonly string[],
): Array<{ key: string; namespace: string | null; service: SgNode | null }> {
  return member.entries.flatMap((entry) => {
    if (entry.key === null || !keys.includes(entry.key) || !entry.value) return [];
    if (entry.key === "db" || entry.key === "resolver") {
      if (entry.value.kind() !== "object") return [];
      return objectEntries(entry.value).map((namespace) => ({
        key: entry.key!,
        namespace:
          member.services.find(
            (ref) => ref.node.range().start.index === namespace.range().start.index,
          )?.name ?? null,
        service: namespace.kind() === "pair" ? pairValue(namespace) : null,
      }));
    }
    return [{ key: entry.key, namespace: null, service: entry.value }];
  });
}

/**
 * The project files a service config's files patterns select, as the SDK reads them from the config's directory.
 * @param paths - Project-relative paths of the project's files
 * @param dir - Project-relative directory of the config
 * @param patterns - The service's patterns
 * @returns The selected project-relative paths
 */
function selectFiles(paths: readonly string[], dir: string, patterns: FilesPatterns): string[] {
  const matchers = patterns.patterns.map((pattern) => {
    const negated = pattern.startsWith("!");
    return {
      negated,
      match: picomatch((negated ? pattern.slice(1) : pattern).replace(/^\.\//u, ""), { dot: true }),
    };
  });
  const ignored = patterns.ignores.map((pattern) =>
    picomatch(pattern.replace(/^\.\//u, ""), { dot: true }),
  );
  return paths.filter((file) => {
    if (!SOURCE_EXTENSIONS.has(path.extname(file))) return false;
    const relative = path.relative(`/${dir}`, `/${file}`);
    let selected = false;
    for (const matcher of matchers) if (matcher.match(relative)) selected = !matcher.negated;
    return selected && !ignored.some((match) => match(relative));
  });
}

/**
 * The function files a config's resolver namespaces, executors, and workflows select.
 * @param cache - Module cache of the project
 * @param member - The config
 * @returns Project-relative paths
 */
function functionFiles(cache: ModuleCache, member: ConfigModule): string[] {
  return [
    ...new Set(
      servicesOf(member, ["resolver", "executor", "workflow"]).flatMap(({ service }) =>
        selectFiles(cache.project.paths, member.dir, patternsOf(service)),
      ),
    ),
  ];
}

function objectKind(cache: ModuleCache, module: SourceModule, object: SgNode): string | null {
  const kind = objectEntries(object).find((entry) => entryKey(entry) === "kind");
  return kind ? resolveString(cache, module, entryValue(kind)) : null;
}

function takesInvoker(call: SgNode, position: number): boolean {
  const name = calleeName(call);
  return name === "createResolver" || (name === "start" && position === 1);
}

function argumentUse(expression: SgNode): "sets" | "passed" | null {
  const written = withTypeOperators(expression);
  const parent = written.parent();
  if (parent?.kind() !== "arguments") return null;
  const call = parent.parent()!;
  const position = callArguments(call).findIndex(
    (argument) => argument.range().start.index === written.range().start.index,
  );
  return takesInvoker(call, position) ? "sets" : "passed";
}

/**
 * Whether an `invoker` entry sets the machine user something runs as: in an object whose `kind`
 * names an operation with one, under an `operation` key, or in a `createResolver()` config or the
 * options of a workflow's `.start()`, also through a `const` the module passes to them. It does not
 * in an object whose `kind` names another operation, is passed on in an object the module only
 * passes to other calls, and may anywhere else.
 * @param cache - Module cache of the project
 * @param module - Module the entry appears in
 * @param entry - The entry
 * @returns Whether it does, does not, is passed to another call, or may
 */
function invokerUse(
  cache: ModuleCache,
  module: SourceModule,
  entry: SgNode,
): "sets" | "no" | "passed" | "may" {
  const object = entry.parent()!;
  const kind = objectKind(cache, module, object);
  if (kind !== null) return OPERATION_KINDS_WITH_INVOKER.has(kind) ? "sets" : "no";
  const written = withTypeOperators(object);
  const parent = written.parent()!;
  if (parent.kind() === "pair") return entryKey(parent) === "operation" ? "sets" : "may";
  if (parent.kind() !== "variable_declarator") return argumentUse(written) ?? "may";
  const declared = parent.children()[0]!;
  const uses = module.root
    .findAll({ rule: { any: [{ kind: "identifier" }, { kind: "shorthand_property_identifier" }] } })
    .filter(
      (reference) =>
        reference.text() === declared.text() &&
        reference.range().start.index !== declared.range().start.index,
    )
    .map((reference) => argumentUse(reference));
  if (uses.includes("sets")) return "sets";
  return uses.length > 0 && uses.every((use) => use === "passed") ? "passed" : "may";
}

/**
 * Rewrite what the merge makes ambiguous in the functions of the merged configs: a string
 * invoker naming a machine user several Auth services define, an IdP or authAccessToken trigger
 * without its service, and a GraphQL operation without its application.
 * @param cache - Module cache of the project
 * @param contexts - The merged configs
 * @param facts - Facts about the merged workspace
 * @returns The rewritten files and the reports for what could not be rewritten
 */
export function rewriteFunctionFiles(
  cache: ModuleCache,
  contexts: readonly MemberContext[],
  facts: GroupFacts,
): { writes: Record<string, string>; findings: Report[] } {
  const owners = new Map<string, MemberContext[]>();
  for (const context of contexts) {
    for (const file of functionFiles(cache, context.member))
      owners.set(file, [...(owners.get(file) ?? []), context]);
  }
  const writes: Record<string, string> = {};
  const findings: Report[] = [];
  for (const [file, fileOwners] of owners) {
    const module = cache.get(file);
    if (!module) continue;
    const edits: TextEdit[] = [];
    const owner = fileOwners.length === 1 ? fileOwners[0]! : null;
    const report = (node: SgNode, message: string) => findings.push({ file, node, message });
    const needs = (
      node: SgNode,
      what: string,
      value: string | null | undefined,
      apply: (value: string) => TextEdit,
    ) => {
      if (!owner)
        report(
          node,
          `Several configs load this file, so the conversion cannot tell which ${what} it means in the merged workspace.`,
        );
      else if (value === null || value === undefined)
        report(
          node,
          `The merged workspace has several of these, and the conversion cannot tell which ${what} this config used.`,
        );
      else edits.push(apply(value));
    };

    if (facts.authCount > 1) {
      for (const pair of module.root.findAll({
        rule: { any: [{ kind: "pair" }, { kind: "shorthand_property_identifier" }] },
      })) {
        if (entryKey(pair) !== "invoker") continue;
        const use = invokerUse(cache, module, pair);
        const value = entryValue(pair);
        const bare = withoutTypeOperators(value);
        if (use === "no" || !value || bare?.kind() === "null" || bare?.kind() === "undefined")
          continue;
        const name = resolveString(cache, module, value);
        if (name === null) {
          if (
            use !== "passed" &&
            !evaluatesToObject(cache, module, value) &&
            machineUserAmbiguity(facts, null) === "unknown"
          ) {
            report(
              pair,
              "The conversion cannot tell whether this invoker names a machine user that several Auth services of the merged workspace define; if it does, write it as { namespace, machineUserName } with the Auth service it belongs to.",
            );
          }
          continue;
        }
        const ambiguity = machineUserAmbiguity(facts, name);
        if (ambiguity === "unknown") {
          report(
            pair,
            `The conversion cannot read every Auth service's machine users, so check whether invoker "${name}" names one that several Auth services define.`,
          );
        }
        if (ambiguity !== "shared") continue;
        if (use !== "sets") {
          report(
            pair,
            `Invoker "${name}" names a machine user several Auth services of the merged workspace define; if it sets the machine user something runs as, write it as { namespace, machineUserName } with the Auth service it belongs to.`,
          );
          continue;
        }
        needs(pair, "Auth service", owner?.authName, (auth) =>
          replaceNode(
            value,
            `${value === pair ? "invoker: " : ""}{ namespace: ${JSON.stringify(auth)}, machineUserName: ${value.text()} }`,
          ),
        );
      }
    }

    for (const call of module.root.findAll({ rule: { kind: "call_expression" } })) {
      const name = calleeName(call);
      const trigger = TRIGGER_SERVICES.find(
        (candidate) => name !== null && candidate.calls.has(name) && candidate.count(facts) > 1,
      );
      if (!trigger) continue;
      const args = call.children().find((child) => child.kind() === "arguments");
      const options = withoutTypeOperators(callArguments(call)[0] ?? null);
      if (
        options?.kind() === "object" &&
        objectEntries(options).some((entry) => entryKey(entry) === trigger.option)
      )
        continue;
      if (options && (options.kind() !== "object" || hasDynamicKey(options))) {
        report(
          call,
          `The merged workspace has several ${trigger.plural}; set \`${trigger.option}\` on this trigger.`,
        );
        continue;
      }
      const property = (service: string) => `${trigger.option}: ${JSON.stringify(service)}`;
      needs(call, trigger.singular, owner && trigger.service(owner), (service) =>
        options
          ? addProperty(module.source, options, property(service))
          : replaceNode(args!, `({ ${property(service)} })`),
      );
    }

    if (facts.appCount > 1) {
      for (const object of module.root.findAll({ rule: { kind: "object" } })) {
        if (objectKind(cache, module, object) !== "graphql") continue;
        if (objectEntries(object).some((entry) => entryKey(entry) === "appName")) continue;
        if (hasDynamicKey(object)) {
          report(
            object,
            "The merged workspace has several applications; set `appName` on this GraphQL operation.",
          );
          continue;
        }
        needs(object, "application", owner?.member.appName, (app) =>
          addProperty(module.source, object, `appName: ${JSON.stringify(app)}`),
        );
      }
    }

    if (edits.length > 0) writes[file] = applyEdits(module.source, edits);
  }
  return { writes, findings };
}

const TABLE_CALL = /\bdb\s*\.\s*(?:table|type)\s*\(\s*(["'`])([^"'`]+)\1/gu;
const RESOLVER_NAME = /\bcreateResolver\s*\(\s*\{[^}]*?\bname\s*:\s*(["'`])([^"'`]+)\1/gu;
const RESOLVER_EXECUTED_TRIGGER = /\bresolverExecutedTrigger\b|(["'`])resolverExecuted\1/u;

function subscribesToResolvers(cache: ModuleCache): boolean {
  return cache.project.paths.some(
    (file) =>
      SOURCE_EXTENSIONS.has(path.extname(file)) &&
      RESOLVER_EXECUTED_TRIGGER.test(cache.project.read(file) ?? ""),
  );
}

/**
 * Report TailorDB type names that two namespaces of the merged workspace both use, which a record
 * trigger or `userProfile` has to name with its namespace, and, when an executor subscribes to
 * resolvers, resolver names that two namespaces both use, which its trigger has to name the same way.
 * @param cache - Module cache of the project
 * @param members - The merged configs
 * @returns The reports, at the second definition
 */
export function reportDuplicateNames(
  cache: ModuleCache,
  members: readonly ConfigModule[],
): Report[] {
  const reports: Report[] = [];
  const checks = [
    [
      "db",
      TABLE_CALL,
      (name: string, namespaces: readonly string[]) =>
        `so a record trigger or \`userProfile\` that names ${name} without \`namespace\` stops \`tailor deploy\`, and seedPlugin names its data files ${namespaces.map((namespace) => `${namespace}.${name}.jsonl`).join(" and ")}. Add \`namespace\` where they name ${name}, and move its seed data to those files.`,
    ],
    ...(subscribesToResolvers(cache)
      ? [
          [
            "resolver",
            RESOLVER_NAME,
            (name: string) =>
              `so a resolverExecutedTrigger() that names ${name} without \`namespace\` stops \`tailor deploy\`. Add \`namespace\` to it.`,
          ] as const,
        ]
      : []),
  ] as const;
  for (const [key, pattern, problem] of checks) {
    const seen = new Map<string, string>();
    for (const member of members) {
      for (const { namespace, service } of servicesOf(member, [key])) {
        if (namespace === null) continue;
        for (const file of selectFiles(cache.project.paths, member.dir, patternsOf(service))) {
          const module = cache.get(file);
          if (!module) continue;
          for (const match of module.source.matchAll(pattern)) {
            const name = match[2]!;
            const first = seen.get(name);
            if (first === undefined) {
              seen.set(name, namespace);
              continue;
            }
            if (first === namespace) continue;
            const node =
              module.root.find({
                rule: {
                  kind: "string",
                  regex: `^.${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}.$`,
                },
              }) ?? module.root;
            reports.push({
              file,
              node,
              message: `Namespaces ${first} and ${namespace} both define ${name}, ${problem(name, [first, namespace])}`,
            });
          }
        }
      }
    }
  }
  return reports;
}
