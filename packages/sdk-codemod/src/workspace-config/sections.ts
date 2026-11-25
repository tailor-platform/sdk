import * as path from "pathe";
import {
  arrayElements,
  entryKey,
  objectEntries,
  pairValue,
  staticEntries,
} from "../ast-grep-helpers";
import { entryValue, resolveString, type ConfigModule, type ServiceRef } from "./config-module";
import { literalText, type ModuleCache, type Report } from "./project";
import {
  addProperty,
  canRebaseFrom,
  editedText,
  lineIndent,
  rebasePattern,
  reindent,
  replaceNode,
  type TextEdit,
} from "./text";
import type { SgNode } from "@ast-grep/napi";

const PATTERN_KEYS: ReadonlySet<string> = new Set(["files", "ignores", "job_files", "job_ignores"]);
const APP_SETTINGS = ["cors", "allowedIpAddresses", "disableIntrospection", "metadata"] as const;
const WORKSPACE_SETTINGS = [
  "buildOptions",
  "defaultDateRepresentation",
  "maintenanceMode",
] as const;
const DEFAULT_SETTINGS: Partial<Record<(typeof WORKSPACE_SETTINGS)[number], string>> = {
  maintenanceMode: '"migration"',
};
const SECTION_ORDER = [
  "env",
  "db",
  "resolver",
  "executor",
  "workflow",
  "httpAdapter",
  "auth",
  "idp",
  "staticWebsites",
  "aiGateways",
  "secrets",
  ...WORKSPACE_SETTINGS,
] as const;
type SectionKey = (typeof SECTION_ORDER)[number];
const IGNORED_KEYS: ReadonlySet<string> = new Set(["name", "id"]);
const INLINE_SECTIONS: ReadonlySet<SectionKey> = new Set(["auth", "idp", "executor", "workflow"]);
const MAX_INLINE = 80;
const UNREAD_FILES = "so the conversion cannot read which files it names.";

/** Source text placed in the workspace config, with the indentation it was written at. */
type Piece = {
  text: string;
  indent: string;
  node?: SgNode;
  /** For a files patterns entry: its key and pattern texts, to merge with another config's. */
  patterns?: { key: string; elements: string[] };
};

type Section = {
  open: "{" | "[";
  /** The value as its only config wrote it, when one config contributed it. */
  whole?: Piece;
  /** Entries or elements to merge when several configs contribute. */
  items: Piece[];
  contributors: number;
};

/** One application of the workspace config. */
type AppSection = {
  name: string;
  settings: Piece[];
  lists: Map<"db" | "resolver" | "auth" | "idp", string[]>;
};

/** The workspace config's sections, before rendering. */
export type WorkspaceSections = {
  values: Map<SectionKey, Section>;
  apps: AppSection[];
  warnings: string[];
  findings: Report[];
  stops: Report[];
};

/** What the sections need to know about the whole group. */
export type GroupFacts = {
  /** Machine user names by Auth service name; null when an Auth service's cannot be read. */
  machineUsers: Map<string, string[]> | null;
  authCount: number;
  idpCount: number;
  appCount: number;
};

/**
 * Whether several Auth services of the merged workspace may define a machine user name.
 * @param facts - What the merge knows about the group
 * @param name - The name, or null when it cannot be read
 * @returns `shared` when several define it, `unknown` when the conversion cannot tell, or null
 */
export function machineUserAmbiguity(
  facts: GroupFacts,
  name: string | null,
): "shared" | "unknown" | null {
  if (facts.authCount < 2) return null;
  if (facts.machineUsers === null) return "unknown";
  const userLists = [...facts.machineUsers.values()];
  const shared = (user: string) => userLists.filter((users) => users.includes(user)).length > 1;
  if (name !== null) return shared(name) ? "shared" : null;
  return userLists.flat().some(shared) ? "unknown" : null;
}

function pieceOf(member: ConfigModule, node: SgNode, edits: readonly TextEdit[] = []): Piece {
  return { text: editedText(node, edits), indent: lineIndent(member.module.source, node), node };
}

function objectValue(node: SgNode | null | undefined): SgNode | null {
  return node?.kind() === "object" ? node : null;
}

function idpName(ref: ServiceRef): string {
  return ref.name ?? ref.node.text();
}

function isIdentifier(text: string | undefined): boolean {
  return text !== undefined && /^[A-Za-z_$][\w$]*$/u.test(text);
}

class SectionsBuilder {
  readonly sections: WorkspaceSections = {
    values: new Map(),
    apps: [],
    warnings: [],
    findings: [],
    stops: [],
  };

  private readonly envKeys = new Map<string, { text: string; members: ConfigModule[] }>();
  private readonly vaults = new Map<string, { text: string; members: ConfigModule[] }>();
  private readonly outputDir: string;

  constructor(
    private readonly cache: ModuleCache,
    private readonly members: readonly ConfigModule[],
    private readonly outputPath: string,
    private readonly facts: GroupFacts,
  ) {
    this.outputDir = path.dirname(outputPath);
  }

  build(): WorkspaceSections {
    for (const member of this.members) this.addMember(member);
    for (const setting of WORKSPACE_SETTINGS) this.addSetting(setting);
    for (const [name, { members }] of this.envKeys) {
      if (members.length === this.members.length) continue;
      this.sections.warnings.push(
        `${this.outputPath}: env key ${name}, which only ${members.map((member) => member.path).join(", ")} set, now reaches every function of the workspace.`,
      );
    }
    return this.sections;
  }

  private stop(member: ConfigModule, node: SgNode, message: string, excerpt?: string): void {
    this.sections.stops.push({
      file: member.path,
      node,
      message,
      ...(excerpt === undefined ? {} : { excerpt }),
    });
  }

  private report(member: ConfigModule, node: SgNode, message: string): void {
    this.sections.findings.push({ file: member.path, node, message });
  }

  private section(key: SectionKey, open: "{" | "["): Section {
    let section = this.sections.values.get(key);
    if (!section) {
      section = { open, items: [], contributors: 0 };
      this.sections.values.set(key, section);
    }
    return section;
  }

  private contribute(key: SectionKey, open: "{" | "[", items: Piece[], whole?: Piece): void {
    const section = this.section(key, open);
    section.contributors += 1;
    section.whole = section.contributors === 1 ? whole : undefined;
    for (const item of items) {
      const existing =
        item.patterns &&
        section.items.find((candidate) => candidate.patterns?.key === item.patterns!.key);
      if (existing?.patterns && item.patterns) {
        const elements = [...existing.patterns.elements, ...item.patterns.elements];
        existing.patterns = { key: existing.patterns.key, elements };
        existing.text = `${existing.patterns.key}: [${elements.join(", ")}]`;
        existing.indent = "";
        existing.node = undefined;
        continue;
      }
      section.items.push(item);
    }
  }

  private addMember(member: ConfigModule): void {
    if (!canRebaseFrom(member.dir) && member.dir !== this.outputDir) {
      this.stop(
        member,
        member.call,
        `The config's directory name holds glob syntax, so its files patterns cannot be rewritten for ${this.outputPath}.`,
      );
      return;
    }
    if (member.appName === null) {
      this.stop(member, member.config, "The application name is not a string literal.");
      return;
    }
    const app: AppSection = { name: member.appName, settings: [], lists: new Map() };
    const list = (service: "db" | "resolver" | "auth" | "idp", expression: string) =>
      app.lists.set(service, [...(app.lists.get(service) ?? []), expression]);
    const auth = member.services.find((ref) => ref.service === "auth");

    for (const entry of member.entries) {
      const { key, value } = entry;
      if (key === null || value === null) {
        this.stop(
          member,
          entry.node,
          "The config has a spread or a computed key, which the conversion cannot place.",
        );
        continue;
      }
      if (IGNORED_KEYS.has(key) || (WORKSPACE_SETTINGS as readonly string[]).includes(key))
        continue;
      if ((APP_SETTINGS as readonly string[]).includes(key)) {
        app.settings.push(pieceOf(member, entry.node));
        continue;
      }
      switch (key) {
        case "env":
        case "secrets":
          this.addRecord(member, key, entry.node, value);
          break;
        case "db":
        case "resolver":
          this.addNamespaces(member, key, entry.node, value, auth, list);
          break;
        case "executor":
        case "workflow":
        case "httpAdapter":
          this.addFilesService(member, key, entry.node, value);
          break;
        case "auth":
          this.addAuth(member, entry.node, auth, list);
          break;
        case "idp":
          this.addIdps(member, entry.node, list);
          break;
        case "staticWebsites":
        case "aiGateways":
          this.addElements(member, key, value);
          break;
        default:
          this.stop(member, entry.node, `\`${key}\` is not a setting of a workspace config.`);
      }
    }
    if (app.lists.size === 0) {
      this.stop(
        member,
        member.config,
        `Application ${member.appName} lists no db, resolver, auth, or idp, which a workspace config requires.`,
      );
    }
    this.sections.apps.push(app);
  }

  private addRecord(
    member: ConfigModule,
    key: "env" | "secrets",
    node: SgNode,
    value: SgNode,
  ): void {
    const object = objectValue(value);
    if (!object) {
      if (this.members.length > 1)
        this.stop(member, node, `\`${key}\` is not an object literal, so it cannot be merged.`);
      else this.contribute(key, "{", [], pieceOf(member, value));
      return;
    }
    const items: Piece[] = [];
    for (const item of objectEntries(object)) {
      const name =
        item.kind() === "shorthand_property_identifier"
          ? item.text()
          : item.kind() === "pair"
            ? (entryKey(item) ?? item.children()[0]!.text())
            : null;
      if (name === null) {
        this.stop(member, item, `\`${key}\` has a spread, so it cannot be merged.`);
        continue;
      }
      const valueText = item.kind() === "pair" ? (pairValue(item)?.text() ?? "") : item.text();
      const records = key === "env" ? this.envKeys : this.vaults;
      const existing = records.get(name);
      if (!existing) {
        records.set(name, { text: valueText, members: [member] });
        items.push(pieceOf(member, item));
      } else if (existing.text === valueText) {
        existing.members.push(member);
      } else if (key === "env") {
        this.stop(
          member,
          item,
          `The configs set env key ${name} differently (${[...existing.members, member].map((other) => other.path).join(", ")}), so they were not merged. A workspace config has one root value per key, which a resolver namespace, the executors, the workflows, or an Auth service can override.`,
          name,
        );
      } else {
        this.stop(
          member,
          item,
          `The configs define secret vault ${name} differently (${[...existing.members, member].map((other) => other.path).join(", ")}), so they were not merged.`,
          name,
        );
      }
    }
    this.contribute(key, "{", items, pieceOf(member, value));
  }

  private addNamespaces(
    member: ConfigModule,
    key: "db" | "resolver",
    node: SgNode,
    value: SgNode,
    auth: ServiceRef | undefined,
    list: (service: "db" | "resolver", expression: string) => void,
  ): void {
    const object = objectValue(value);
    if (!object) {
      this.stop(
        member,
        node,
        `\`${key}\` is not an object literal, so its namespaces cannot be read.`,
      );
      return;
    }
    const edits: TextEdit[] = [];
    const items: Piece[] = [];
    for (const namespace of objectEntries(object)) {
      const ref = member.services.find(
        (candidate) =>
          candidate.service === key &&
          candidate.node.range().start.index === namespace.range().start.index,
      );
      if (!ref || ref.name === null || ref.nameExpression === null) {
        this.stop(member, namespace, `A \`${key}\` namespace name cannot be read from the source.`);
        continue;
      }
      list(key, ref.nameExpression);
      if (ref.external) continue;
      const namespaceObject = objectValue(pairValue(namespace));
      if (!namespaceObject && this.members.length > 1) {
        this.stop(
          member,
          namespace,
          `The \`${key}\` namespace "${ref.name}" is not an object literal, ${UNREAD_FILES}`,
        );
        continue;
      }
      const namespaceEdits = namespaceObject ? this.rebaseEdits(member, namespaceObject) : [];
      if (namespaceObject && key === "db") {
        const edit = this.migrationMachineUserEdit(member, namespaceObject, auth);
        if (edit) namespaceEdits.push(edit);
      }
      edits.push(...namespaceEdits);
      items.push(pieceOf(member, namespace, namespaceEdits));
    }
    const hasExternal = member.services.some((ref) => ref.service === key && ref.external);
    this.contribute(key, "{", items, hasExternal ? undefined : pieceOf(member, value, edits));
  }

  private addFilesService(
    member: ConfigModule,
    key: "executor" | "workflow" | "httpAdapter",
    node: SgNode,
    value: SgNode,
  ): void {
    if (key === "httpAdapter" && this.facts.appCount > 1) {
      this.stop(
        member,
        node,
        "`httpAdapter` serves one application, and the merged workspace has several.",
      );
      return;
    }
    const object = objectValue(value);
    if (!object) {
      if (this.members.length > 1) {
        this.stop(member, node, `\`${key}\` is not an object literal, ${UNREAD_FILES}`);
      } else this.contribute(key, "{", [], pieceOf(member, value));
      return;
    }
    const edits = this.rebaseEdits(member, object);
    const items = objectEntries(object).map((item): Piece => {
      const itemKey = entryKey(item);
      const itemValue = item.kind() === "pair" ? pairValue(item) : null;
      const piece = pieceOf(member, item, edits);
      if (itemKey !== null && PATTERN_KEYS.has(itemKey) && itemValue?.kind() === "array") {
        piece.patterns = {
          key: itemKey,
          elements: arrayElements(itemValue).map((element) => editedText(element, edits)),
        };
      } else if (
        this.sections.values
          .get(key)
          ?.items.some((existing) => existing.node && entryKey(existing.node) === itemKey)
      ) {
        this.stop(
          member,
          item,
          `Another config also sets \`${key}.${itemKey}\`; a workspace config has one.`,
        );
      }
      return piece;
    });
    this.contribute(key, "{", items, pieceOf(member, value, edits));
  }

  private addAuth(
    member: ConfigModule,
    node: SgNode,
    auth: ServiceRef | undefined,
    list: (service: "auth", expression: string) => void,
  ): void {
    if (!auth || auth.nameExpression === null) {
      this.stop(member, node, "The Auth service cannot be read from the source.");
      return;
    }
    list("auth", auth.nameExpression);
    if (auth.external) return;
    const keyText = this.definitionKey(auth);
    if (keyText === null) {
      this.stop(member, node, "The Auth service's name cannot be read from the source.");
      return;
    }
    this.contribute("auth", "{", [
      {
        text: `${keyText}: ${auth.definitionExpression}`,
        indent: lineIndent(member.module.source, node),
        node,
      },
    ]);
  }

  private addIdps(
    member: ConfigModule,
    node: SgNode,
    list: (service: "idp", expression: string) => void,
  ): void {
    const refs = member.services.filter((ref) => ref.service === "idp");
    if (refs.length === 0) return;
    if (refs.some((ref) => ref.nameExpression === null)) {
      this.stop(member, node, "An IdP cannot be read from the source.");
      return;
    }
    list("idp", `[${refs[0]!.nameExpression}]`);
    if (refs.length > 1) {
      this.sections.warnings.push(
        `${member.path}: application ${member.appName} exposes only the first of its IdPs (${idpName(refs[0]!)}) in its GraphQL API, as before; the others (${refs
          .slice(1)
          .map(idpName)
          .join(", ")}) stay defined in the workspace.`,
      );
    }
    const items: Piece[] = [];
    for (const ref of refs) {
      if (ref.external) continue;
      const keyText = this.definitionKey(ref);
      if (keyText === null) {
        this.stop(member, ref.node, "The IdP's name cannot be read from the source.");
        continue;
      }
      items.push({
        text: `${keyText}: ${ref.definitionExpression}`,
        indent: lineIndent(member.module.source, ref.node),
        node: ref.node,
      });
    }
    this.contribute("idp", "{", items);
  }

  private definitionKey(ref: ServiceRef): string | null {
    if (isIdentifier(ref.definitionExpression)) return `[${ref.nameExpression}]`;
    return ref.name === null ? null : JSON.stringify(ref.name);
  }

  private addElements(
    member: ConfigModule,
    key: "staticWebsites" | "aiGateways",
    value: SgNode,
  ): void {
    if (value.kind() === "array") {
      this.contribute(
        key,
        "[",
        arrayElements(value).map((element) => pieceOf(member, element)),
        pieceOf(member, value),
      );
    } else {
      this.contribute(
        key,
        "[",
        [{ text: `...${value.text()}`, indent: "", node: value }],
        pieceOf(member, value),
      );
    }
  }

  private addSetting(setting: (typeof WORKSPACE_SETTINGS)[number]): void {
    const values = this.members.map((member) => {
      const entry = member.entries.find((candidate) => candidate.key === setting);
      const literal = literalText(entry?.value);
      const text = literal === null ? entry?.value?.text() : JSON.stringify(literal);
      return { member, entry, text: text ?? DEFAULT_SETTINGS[setting] };
    });
    const distinct = new Set(values.map(({ text }) => text));
    const first = values.find(({ entry }) => entry?.value);
    if (distinct.size > 1) {
      const described =
        setting === "buildOptions"
          ? values.map(({ member }) => member.path).join(", ")
          : values.map(({ member, text }) => `${member.path}: ${text ?? "not set"}`).join(", ");
      this.stop(
        first?.member ?? values[0]!.member,
        first?.entry?.node ?? values[0]!.member.config,
        `The configs set \`${setting}\` differently (${described}); a workspace config has one.`,
      );
      return;
    }
    if (!first?.entry?.value) return;
    const options = staticEntries(first.entry.value);
    if (
      setting === "buildOptions" &&
      this.members.some((member) => member.dir !== this.outputDir) &&
      (!options || options.some((entry) => entryKey(entry) === "inlineSourcemapProjectSources"))
    ) {
      this.stop(
        first.member,
        first.entry.node,
        `\`buildOptions\` sets, or may set, \`inlineSourcemapProjectSources\`, whose globs are relative to each config's directory and are not rewritten for ${this.outputPath}.`,
      );
      return;
    }
    this.contribute(setting, "{", [], pieceOf(first.member, first.entry.value));
  }

  /**
   * Edits that rewrite the files patterns and the migration directory of a service config so
   * that they name the same files relative to the workspace config's directory, and stops the
   * merge on those it cannot read.
   */
  private rebaseEdits(member: ConfigModule, service: SgNode): TextEdit[] {
    if (this.members.length === 1) return [];
    const moved = member.dir !== this.outputDir;
    const edits: TextEdit[] = [];
    const rebase = (node: SgNode, literal: string) => {
      if (!moved) return;
      const quote = node.text()[0]!;
      edits.push(
        replaceNode(node, `${quote}${rebasePattern(literal, member.dir, this.outputDir)}${quote}`),
      );
    };
    for (const entry of objectEntries(service)) {
      const key = entryKey(entry);
      const value = entry.kind() === "pair" ? pairValue(entry) : null;
      if (key === null) {
        this.stop(
          member,
          entry,
          "This spread or computed key may hold files patterns, which the conversion cannot read.",
        );
      } else if (PATTERN_KEYS.has(key)) {
        if (value?.kind() !== "array") {
          this.stop(member, entry, `\`${key}\` is not an array literal, ${UNREAD_FILES}`);
          continue;
        }
        for (const element of arrayElements(value)) {
          const literal = literalText(element);
          if (literal === null) {
            this.stop(member, element, `This \`${key}\` pattern is not a literal, ${UNREAD_FILES}`);
          } else rebase(element, literal);
        }
      } else if (key === "migration" && moved) {
        const directory = staticEntries(value)?.find(
          (candidate) => entryKey(candidate) === "directory",
        );
        const directoryValue = directory ? pairValue(directory) : null;
        const literal = literalText(directoryValue);
        if (directoryValue && literal !== null) {
          rebase(directoryValue, literal);
        } else {
          this.stop(
            member,
            entry,
            `\`migration.directory\` cannot be read from the source, so it cannot be rewritten for ${this.outputPath}.`,
          );
        }
      }
    }
    return edits;
  }

  /**
   * An edit that adds the machine user migrations ran as when the merged workspace has several
   * Auth services, or a report when it cannot.
   */
  private migrationMachineUserEdit(
    member: ConfigModule,
    namespace: SgNode,
    auth: ServiceRef | undefined,
  ): TextEdit | null {
    if (this.facts.authCount < 2) return null;
    const migration = objectEntries(namespace).find((entry) => entryKey(entry) === "migration");
    if (!migration) return null;
    const migrationObject = objectValue(pairValue(migration));
    const entries = migrationObject ? objectEntries(migrationObject) : [];
    const machineUserAt = entries.findLastIndex((entry) => entryKey(entry) === "machineUser");
    if (
      !migrationObject ||
      entries.slice(machineUserAt + 1).some((entry) => entryKey(entry) === null)
    ) {
      this.report(
        member,
        migration,
        "`migration` cannot be read from the source, and the merged workspace has several Auth services; set `migration.machineUser` to the machine user migrations ran as, which only one Auth service may define.",
      );
      return null;
    }
    const machineUser = machineUserAt === -1 ? undefined : entries[machineUserAt];
    if (machineUser) {
      const name = resolveString(this.cache, member.module, entryValue(machineUser));
      const ambiguity = machineUserAmbiguity(this.facts, name);
      if (ambiguity === "shared") {
        this.stop(
          member,
          machineUser,
          `Migrations run as machine user "${name}", which several Auth services of the merged workspace define, and \`migration.machineUser\` cannot name the Auth service.`,
        );
      } else if (ambiguity === "unknown") {
        this.report(
          member,
          machineUser,
          "The conversion cannot tell whether several Auth services of the merged workspace define the machine user `migration.machineUser` names; check that only one does, since `migration.machineUser` cannot name the Auth service.",
        );
      }
      return null;
    }
    const first = auth?.auth?.machineUsers?.[0];
    const ambiguity = first === undefined ? null : machineUserAmbiguity(this.facts, first);
    if (first === undefined || ambiguity === "unknown") {
      this.report(
        member,
        migration,
        "Migrations ran as the first machine user of this config's Auth service; the merged workspace has several Auth services, so set `migration.machineUser`.",
      );
      return null;
    }
    if (ambiguity === "shared") {
      this.stop(
        member,
        migration,
        `Migrations ran as machine user "${first}", which several Auth services of the merged workspace define, and \`migration.machineUser\` cannot name the Auth service.`,
      );
      return null;
    }
    return addProperty(
      member.module.source,
      migrationObject,
      `machineUser: ${JSON.stringify(first)}`,
    );
  }
}

/**
 * Collect the workspace config's sections from the members' `defineConfig()` objects.
 * @param cache - Module cache, to read the values members import or declare
 * @param members - The configs to merge, in order
 * @param outputPath - Project-relative path of the workspace config
 * @param facts - What the sections need to know about the whole group
 * @returns The sections, warnings, findings, and the reasons the configs cannot be merged
 */
export function collectSections(
  cache: ModuleCache,
  members: readonly ConfigModule[],
  outputPath: string,
  facts: GroupFacts,
): WorkspaceSections {
  return new SectionsBuilder(cache, members, outputPath, facts).build();
}

function inlineOrBlock(
  pieces: readonly Piece[],
  indent: string,
  open: "{" | "[",
  prefixLength: number,
  allowInline: boolean,
): string {
  const close = open === "{" ? "}" : "]";
  const pad = open === "{" ? " " : "";
  const inline = `${open}${pad}${pieces.map((piece) => piece.text).join(", ")}${pad}${close}`;
  if (
    allowInline &&
    !inline.includes("\n") &&
    indent.length + prefixLength + inline.length + 1 <= MAX_INLINE
  ) {
    return inline;
  }
  const inner = `${indent}  `;
  const body = pieces.map(
    (piece) => `${inner}${reindent(piece.text, piece.indent, inner, piece.node)},`,
  );
  return [open, ...body, `${indent}${close}`].join("\n");
}

/**
 * Render the workspace config object.
 * @param sections - The sections
 * @returns The object literal, starting with `{`, written for the top level
 */
export function renderWorkspaceObject(sections: WorkspaceSections): string {
  const lines: string[] = ["{"];
  for (const key of SECTION_ORDER) {
    const section = sections.values.get(key);
    if (!section) continue;
    const prefix = `${key}: `.length + 2;
    const value =
      section.whole && section.contributors === 1
        ? reindent(section.whole.text, section.whole.indent, "  ", section.whole.node)
        : inlineOrBlock(section.items, "  ", section.open, prefix, INLINE_SECTIONS.has(key));
    lines.push(`  ${key}: ${value},`);
  }
  lines.push("  apps: {");
  for (const app of sections.apps) {
    const pieces: Piece[] = [...app.settings];
    for (const service of ["db", "resolver", "auth", "idp"] as const) {
      const expressions = app.lists.get(service);
      if (!expressions) continue;
      const text =
        service === "auth" || service === "idp"
          ? `${service}: ${expressions[0]}`
          : `${service}: [${expressions.join(", ")}]`;
      pieces.push({ text, indent: "" });
    }
    const key = isIdentifier(app.name) ? app.name : JSON.stringify(app.name);
    lines.push(`    ${key}: ${inlineOrBlock(pieces, "    ", "{", key.length + 6, true)},`);
  }
  lines.push("  },", "}");
  return lines.join("\n");
}
