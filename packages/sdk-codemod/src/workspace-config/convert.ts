import * as path from "pathe";
import { lineOfIndex, movedIndex } from "../moved-text";
import { composeMembers, renderImports } from "./compose";
import { scanConfigs, type ConfigModule } from "./config-module";
import { reportDuplicateNames, rewriteFunctionFiles } from "./function-files";
import { findConfigPathUses, groupConfigs, type ConfigGroup, type ConfigPathUse } from "./groups";
import { toDefineApp, toDefineWorkspaceInPlace } from "./in-place";
import { Lock } from "./lock";
import { ModuleCache, toFinding, type Report } from "./project";
import { redirectReferences } from "./references";
import { collectSections, renderWorkspaceObject, type GroupFacts } from "./sections";
import type { ProjectChanges, ProjectFiles } from "../types";

const WORKSPACE_CONFIG = "tailor.config.ts";

/** Which groups a codemod converts. */
export type ConversionKind = "app" | "workspace";

function takeoverWarning(configPath: string): string {
  return `${configPath}: the next \`tailor deploy\` asks to take over the resources that defineConfig() deployed. Check its plan with \`tailor deploy --dry-run\` first, then run it where it can prompt, or pass --yes.`;
}

const SEED_MACHINE_USER = /\bseedPlugin\s*\([^)]*?\bmachineUserName\s*:\s*(["'`])([^"'`]+)\1/u;

/**
 * Facts about a group's services that the merge depends on.
 * @param members - The group's configs
 * @returns The facts
 */
function groupFacts(members: readonly ConfigModule[]): GroupFacts {
  const auths = members.flatMap((member) =>
    member.services.filter((ref) => ref.service === "auth" && !ref.external),
  );
  const machineUsers = new Map<string, string[]>();
  let readable = true;
  for (const auth of auths) {
    if (auth.name === null || !auth.auth || auth.auth.machineUsers === null) readable = false;
    else machineUsers.set(auth.name, auth.auth.machineUsers);
  }
  return {
    machineUsers: readable ? machineUsers : null,
    authCount: auths.length,
    idpCount: members.flatMap((member) =>
      member.services.filter((ref) => ref.service === "idp" && !ref.external),
    ).length,
    appCount: members.length,
  };
}

/**
 * A report on a merged config's code, at the line of the workspace config that code moved to.
 * @param report - The report, on a member of the merge
 * @param outputPath - Project-relative path of the workspace config
 * @param output - The workspace config's content
 * @returns The report on the workspace config
 */
function movedReport(report: Report, outputPath: string, output: string): Report {
  if (!("node" in report)) return report;
  const { node } = report;
  const at = movedIndex(
    node.getRoot().root().text(),
    node.range().start.index,
    node.text().split("\n", 1)[0]!.length,
    output,
  );
  return { ...toFinding(report), file: outputPath, line: at === -1 ? 1 : lineOfIndex(output, at) };
}

class Conversion {
  readonly changes: Required<Omit<ProjectChanges, "findings">> & { findings: Report[] } = {
    writes: {},
    deletes: [],
    mergedInto: {},
    warnings: [],
    findings: [],
  };

  /** Paths of the configs this conversion merged. */
  readonly converted = new Set<string>();

  constructor(
    readonly project: ProjectFiles,
    readonly cache: ModuleCache,
    readonly lock: Lock | null,
    /** Project-relative path of a lock file that is not a JSON object. */
    readonly invalidLock: string | null,
  ) {}

  convertApp(group: ConfigGroup): void {
    const [member] = group.members;
    if (!member) return;
    const hidden = member.entries.find((entry) => entry.key === null);
    if (hidden) {
      this.changes.findings.push({
        file: member.path,
        node: hidden.node,
        message:
          "The config has a spread or a computed key, which may hold settings defineApp() does not take, so it was not converted.",
      });
      return;
    }
    const idps = member.services.filter((ref) => ref.service === "idp");
    const unreadableIdp = idps.find((ref) => ref.name === null);
    if (unreadableIdp) {
      this.changes.findings.push({
        file: member.path,
        node: unreadableIdp.node,
        message:
          "The conversion cannot tell which IdPs `idp` holds, so the config was not converted. A defineApp() config takes one IdP; a config with several becomes a defineWorkspace() config with one application.",
      });
      return;
    }
    if (idps.length > 1) {
      const sections = collectSections(this.cache, [member], member.path, groupFacts([member]));
      if (sections.stops.length > 0) {
        this.changes.findings.push(...sections.stops);
        return;
      }
      this.changes.findings.push(...sections.findings);
      this.changes.warnings.push(...sections.warnings);
      this.changes.writes[member.path] = toDefineWorkspaceInPlace(
        member,
        renderWorkspaceObject(sections),
      );
    } else {
      this.changes.writes[member.path] = toDefineApp(member);
    }
    this.lock?.recordWorkspace(member.path);
    this.changes.warnings.push(
      takeoverWarning(member.path),
      ...(this.lock?.unsupportedJobWarnings(member.dir) ?? []),
    );
  }

  convertWorkspace(group: ConfigGroup, uses: readonly ConfigPathUse[]): void {
    const members = group.members.toSorted(
      (a, b) =>
        a.services.filter((ref) => ref.external).length -
          b.services.filter((ref) => ref.external).length || a.path.localeCompare(b.path),
    );
    const outputPath = WORKSPACE_CONFIG;
    if (!members.some((member) => member.path === outputPath)) {
      const taken =
        outputPath in this.changes.writes
          ? `Another group of configs was merged into ${outputPath}, so the configs deployed together with this one were not merged. Run the upgrade from a directory that holds only this group's configs, or merge them by hand.`
          : this.project.exists(outputPath)
            ? `${outputPath} already exists in the upgraded directory, so the configs deployed together with this one were not merged into it.`
            : null;
      if (taken !== null) {
        this.changes.findings.push({
          file: members[0]!.path,
          node: members[0]!.call,
          message: taken,
        });
        return;
      }
    }
    const composed = composeMembers(this.cache, members, outputPath);
    const facts = groupFacts(composed.members);
    const sections = collectSections(this.cache, composed.members, outputPath, facts);
    const stops = [...composed.stops, ...sections.stops];
    const plugins = composed.plugins ?? [];
    if (plugins.some((plugin) => /^seedPlugin\s*\(/u.test(plugin))) {
      const builtIn = composed.members.flatMap((member) =>
        member.services.filter(
          (ref) => ref.service === "auth" && !ref.external && ref.auth?.builtInIdpUserProfile,
        ),
      );
      if (builtIn.length > 1) {
        stops.push({
          file: members[0]!.path,
          node: members[0]!.call,
          message: `seedPlugin seeds the users of one built-in IdP, and the merged workspace would have several Auth services with one (${builtIn.map((ref) => ref.name).join(", ")}).`,
        });
      }
    }
    if (stops.length > 0) {
      this.changes.findings.push(...stops);
      return;
    }

    const rewrites = rewriteFunctionFiles(
      this.cache,
      composed.members.map((member) => ({
        member,
        authName: member.services.find((ref) => ref.service === "auth")?.name ?? null,
        idpName: member.services.find((ref) => ref.service === "idp")?.name ?? null,
      })),
      facts,
    );
    const merged = members
      .map((member) => member.path)
      .filter((memberPath) => memberPath !== outputPath);
    const references = redirectReferences(
      new ModuleCache(withWrites(this.project, rewrites.writes)),
      merged,
      outputPath,
      uses,
      new Set(this.lock?.managedWorkflowFiles() ?? []),
    );

    const pluginsText =
      composed.plugins === null
        ? null
        : (composed.pluginsStatement ??
          `export const plugins = definePlugins(\n${plugins.map((plugin) => `  ${plugin},`).join("\n")}\n);`);
    const imports = renderImports(composed, [
      "defineWorkspace",
      ...(pluginsText !== null && composed.pluginsStatement === null ? ["definePlugins"] : []),
    ]);
    const statements = composed.statements
      .filter((block) => block.length > 0)
      .map((block) => block.join("\n"));
    const text = [
      imports.join("\n"),
      ...statements,
      `export default defineWorkspace(${renderWorkspaceObject(sections)});`,
      ...(pluginsText === null ? [] : [pluginsText]),
    ].join("\n\n");
    const output = `${text}\n`;
    this.changes.writes[outputPath] = output;
    for (const member of members) this.converted.add(member.path);
    Object.assign(this.changes.writes, rewrites.writes, references.writes);
    this.changes.deletes.push(...merged, ...references.deletes);
    for (const memberPath of merged) this.changes.mergedInto[memberPath] = outputPath;

    const pluginNames = plugins.map((plugin) => /^([A-Za-z_$][\w$]*)\s*\(/u.exec(plugin)?.[1]);
    const lines = text.split("\n");
    const seedMachineUser = plugins
      .map((plugin) => SEED_MACHINE_USER.exec(plugin)?.[2])
      .find((name) => name !== undefined);
    if (
      seedMachineUser !== undefined &&
      facts.authCount > 1 &&
      [...(facts.machineUsers?.values() ?? [])].filter((users) => users.includes(seedMachineUser))
        .length !== 1
    ) {
      const line = lines.findIndex((candidate) => candidate.includes("seedPlugin(")) + 1;
      this.changes.findings.push({
        file: outputPath,
        line: Math.max(line, 1),
        excerpt: "seedPlugin",
        message: `seedPlugin seeds as machine user "${seedMachineUser}", and the merged workspace has several Auth services; write it as { namespace, machineUserName } with the Auth service it belongs to.`,
      });
    }
    for (const name of new Set(pluginNames)) {
      const count = pluginNames.filter((candidate) => candidate === name).length;
      if (name === undefined || count < 2) continue;
      const line =
        lines.findLastIndex((candidate) => candidate.trimStart().startsWith(`${name}(`)) + 1;
      this.changes.findings.push({
        file: outputPath,
        line: Math.max(line, 1),
        excerpt: name,
        message: `${name} is registered ${count} times; keep one, since a workspace config runs each plugin once for every namespace.`,
      });
    }

    this.changes.findings.push(
      ...[...composed.findings, ...sections.findings].map((report) =>
        movedReport(report, outputPath, output),
      ),
      ...rewrites.findings,
      ...references.findings,
      ...reportDuplicateNames(this.cache, composed.members),
    );
    this.lock?.recordWorkspace(outputPath, merged);
    const retarget = this.lock?.retarget(
      members.map((member) => member.dir),
      path.dirname(outputPath),
    );
    this.changes.warnings.push(
      takeoverWarning(outputPath),
      ...sections.warnings,
      ...references.warnings,
    );
    if (references.deletes.length > 0) {
      this.changes.warnings.push(
        `${outputPath}: run \`tailor generate\` to generate its type definitions, which replace the ones the conversion deleted (${references.deletes.join(", ")}).`,
      );
    }
    if (retarget) {
      for (const label of retarget.retargeted) {
        this.changes.warnings.push(
          `${this.lock!.path}: the ${label} workflow now deploys ${outputPath}. Run \`tailor setup update\` to regenerate it.`,
        );
      }
      this.changes.warnings.push(...retarget.warnings);
    }
  }

  result(): ProjectChanges {
    const lockText = this.lock?.render();
    if (lockText) this.changes.writes[this.lock!.path] = lockText;
    if (this.invalidLock !== null && Object.keys(this.changes.writes).length > 0) {
      this.changes.warnings.push(
        `${this.invalidLock} is not a JSON object, so the conversion left it as it is. Record each converted config under \`workspaces\` and remove its \`appIds\` entry by hand.`,
      );
    }
    return { ...this.changes, findings: this.changes.findings.map(toFinding) };
  }
}

/**
 * Convert the project's `defineConfig()` configs.
 * @param project - The project
 * @param kind - `app` converts each config deployed on its own; `workspace` merges the configs deployed together
 * @returns The changes
 */
export function convertConfigs(project: ProjectFiles, kind: ConversionKind): ProjectChanges {
  const cache = new ModuleCache(project);
  const found = Lock.find(project);
  const lock = found instanceof Lock ? found : null;
  const uses = findConfigPathUses(cache);
  const scan = scanConfigs(cache, [
    ...uses.flatMap((use) => use.paths),
    ...(lock?.appIdConfigPaths() ?? []),
  ]);
  const groups = groupConfigs(scan.configs, uses, lock, (relativePath) =>
    project.exists(relativePath),
  );
  const conversion = new Conversion(project, cache, lock, typeof found === "string" ? found : null);
  if (kind === "app") conversion.changes.findings.push(...scan.unconvertible);
  for (const group of groups) {
    const isApp = group.members.length === 1;
    if (isApp !== (kind === "app")) continue;
    if (group.blockers.length > 0) {
      conversion.changes.findings.push(...group.blockers);
      continue;
    }
    if (kind === "app") conversion.convertApp(group);
    else conversion.convertWorkspace(group, uses);
  }
  if (kind === "workspace") {
    const remaining = [
      ...scan.configs
        .map((config) => config.path)
        .filter((configPath) => !conversion.converted.has(configPath)),
      ...scan.unconvertible.map((report) => report.file),
    ].toSorted();
    const handBack =
      conversion.converted.size > 0 || scan.v3Configs.length > 0
        ? " Deploying it to the workspace of a converted config hands that workspace's resources back to it after a confirmation; deploy each workspace from one config."
        : "";
    for (const configPath of remaining) {
      conversion.changes.warnings.push(
        `${configPath}: still defineConfig(), which v3 removes.${handBack}`,
      );
    }
  }
  return conversion.result();
}

function withWrites(project: ProjectFiles, writes: Readonly<Record<string, string>>): ProjectFiles {
  return {
    ...project,
    read: (relativePath) => writes[path.normalize(relativePath)] ?? project.read(relativePath),
  };
}
