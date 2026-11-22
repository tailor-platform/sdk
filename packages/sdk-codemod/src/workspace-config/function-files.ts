import * as path from "pathe";
import picomatch from "picomatch";
import { arrayElements, entryKey, objectEntries, pairValue } from "../ast-grep-helpers";
import { SOURCE_EXTENSIONS } from "../walk-files";
import { literalText, type ModuleCache, type Report } from "./project";
import { addProperty, applyEdits, replaceNode, type TextEdit } from "./text";
import type { ConfigModule } from "./config-module";
import type { GroupFacts } from "./sections";
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

function calleeName(call: SgNode): string | null {
  const callee = call.children()[0];
  if (callee?.kind() === "identifier") return callee.text();
  if (callee?.kind() === "member_expression") return callee.children().at(-1)?.text() ?? null;
  return null;
}

function callArgs(call: SgNode): SgNode | null {
  return call.children().find((child) => child.kind() === "arguments") ?? null;
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
      for (const pair of module.root.findAll({ rule: { kind: "pair" } })) {
        if (entryKey(pair) !== "invoker") continue;
        const value = pairValue(pair);
        const name = literalText(value);
        if (name === null || !value) continue;
        if (facts.machineUsers === null) {
          report(
            pair,
            `The conversion cannot read every Auth service's machine users, so check whether invoker "${name}" names one that several Auth services define.`,
          );
          continue;
        }
        const definers = [...facts.machineUsers]
          .filter(([, users]) => users.includes(name))
          .map(([auth]) => auth);
        if (definers.length < 2) continue;
        needs(pair, "Auth service", owner?.authName, (auth) =>
          replaceNode(
            value,
            `{ namespace: ${JSON.stringify(auth)}, machineUserName: ${JSON.stringify(name)} }`,
          ),
        );
      }
    }

    for (const call of module.root.findAll({ rule: { kind: "call_expression" } })) {
      const name = calleeName(call);
      const option =
        name !== null && IDP_TRIGGERS.has(name) && facts.idpCount > 1
          ? "idp"
          : name !== null && AUTH_TRIGGERS.has(name) && facts.authCount > 1
            ? "auth"
            : null;
      if (option === null) continue;
      const args = callArgs(call);
      const values =
        args
          ?.children()
          .filter((child) => !["(", ")", ",", "comment"].includes(String(child.kind()))) ?? [];
      const options = values[0];
      if (options && options.kind() !== "object") {
        report(
          call,
          `The merged workspace has several ${option === "idp" ? "IdPs" : "Auth services"}; set \`${option}\` on this trigger.`,
        );
        continue;
      }
      if (options && objectEntries(options).some((entry) => entryKey(entry) === option)) continue;
      needs(
        call,
        option === "idp" ? "IdP" : "Auth service",
        option === "idp" ? owner?.idpName : owner?.authName,
        (service) =>
          options
            ? addProperty(module.source, options, `${option}: ${JSON.stringify(service)}`)
            : replaceNode(args!, `({ ${option}: ${JSON.stringify(service)} })`),
      );
    }

    if (facts.appCount > 1) {
      for (const object of module.root.findAll({ rule: { kind: "object" } })) {
        const entries = objectEntries(object);
        const kind = entries.find((entry) => entryKey(entry) === "kind");
        if (!kind || literalText(pairValue(kind)) !== "graphql") continue;
        if (entries.some((entry) => entryKey(entry) === "appName")) continue;
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

/**
 * Report TailorDB type names and resolver names that two namespaces of the merged workspace both
 * use, which a workspace config rejects or resolves to one of them.
 * @param cache - Module cache of the project
 * @param members - The merged configs
 * @returns The reports, at the second definition
 */
export function reportDuplicateNames(
  cache: ModuleCache,
  members: readonly ConfigModule[],
): Report[] {
  const reports: Report[] = [];
  for (const [key, pattern, problem] of [
    [
      "db",
      TABLE_CALL,
      "a workspace config needs TailorDB type names to be unique across its namespaces",
    ],
    [
      "resolver",
      RESOLVER_NAME,
      "an executor's resolverExecutedTrigger() names a resolver only by its name, so it subscribes to one of them",
    ],
  ] as const) {
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
              message: `Namespaces ${first} and ${namespace} both define ${name}, and ${problem}. Rename one of them.`,
            });
          }
        }
      }
    }
  }
  return reports;
}
