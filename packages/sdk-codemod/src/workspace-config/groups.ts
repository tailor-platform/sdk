import * as path from "pathe";
import type { ConfigModule, ServiceRef } from "./config-module";
import type { Lock } from "./lock";
import type { ModuleCache, Report } from "./project";

/** Configs that deploy to one workspace, and what keeps them from being converted together. */
export type ConfigGroup = {
  members: ConfigModule[];
  /** Externals no member defines, and configs deployed together with members outside the project. */
  blockers: Report[];
};

const DEPLOY_COMMAND =
  /(?:^|[\s;&|("'])(?:(?:npx|bunx|pnpm(?:\s+exec)?|yarn)\s+)?(?:[^\s;&|("'=]*\/)?tailor\s+deploy\b([^;&|]*)/gu;
const CONFIG_OPTION = /(?:^|\s)(?:-c|--config)(?:=|\s+)(["']?)([^\s"']+)\1/gu;
const CONFIG_PATH_ENV = /\bTAILOR_CONFIG_PATH\s*[:=]\s*(["']?)([^\s"'#]+)\1/gu;
/** A line, joined with the lines a trailing `\` continues it onto. */
const SHELL_LINE = /^(?:.*\\\r?\n)*.*$/gmu;

/** A use of config paths in a script or workflow, with where it is. */
export type ConfigPathUse = {
  /** Project-relative path of the file that names the configs. */
  file: string;
  /** One-based line. */
  line: number;
  excerpt: string;
  /** Project-relative paths the use names. */
  paths: string[];
  /** Whether the configs are deployed together by it. */
  deploysTogether: boolean;
};

function lineAt(source: string, index: number): { line: number; excerpt: string } {
  const start = source.lastIndexOf("\n", index - 1) + 1;
  const end = source.indexOf("\n", index);
  return {
    line: source.slice(0, index).split("\n").length,
    excerpt: source.slice(start, end === -1 ? undefined : end).trim(),
  };
}

function splitPaths(value: string, baseDir: string): string[] {
  return value
    .split(",")
    .filter((entry) => entry !== "")
    .map((entry) => path.normalize(path.join(baseDir, entry)));
}

/**
 * The `-c`/`--config` options of the `tailor` commands in a command line.
 * @param file - Project-relative path of the file that holds the command line
 * @param source - The file's contents
 * @param range - Where the command line is in `source`
 * @param range.start - Its start index
 * @param range.end - Its end index
 * @param baseDir - Project-relative directory the command runs in
 * @returns Each option, located at its own line
 */
function configOptionUses(
  file: string,
  source: string,
  range: { start: number; end: number },
  baseDir: string,
): ConfigPathUse[] {
  const text = source.slice(range.start, range.end);
  const deploys = [...text.matchAll(DEPLOY_COMMAND)];
  return [...text.matchAll(CONFIG_OPTION)].map((option) => ({
    file,
    ...lineAt(source, range.start + option.index + option[0].search(/\S/u)),
    paths: splitPaths(option[2]!, baseDir),
    deploysTogether: deploys.some((match) => match[1]!.includes(option[0].trim())),
  }));
}

/**
 * Find the scripts and workflows that name config paths: `-c`/`--config` in package.json scripts
 * and workflow steps, and `TAILOR_CONFIG_PATH` in package.json scripts, workflows, and `.env` files.
 * @param cache - Module cache of the project
 * @returns Each use
 */
export function findConfigPathUses(cache: ModuleCache): ConfigPathUse[] {
  const uses: ConfigPathUse[] = [];
  for (const file of cache.project.paths) {
    const name = path.basename(file);
    if (name === "package.json") {
      const source = cache.project.read(file) ?? "";
      for (const command of source.matchAll(/"(?:[^"\\]|\\.)*"/gu)) {
        const text = command[0];
        if (!/\btailor\b/u.test(text)) continue;
        const range = { start: command.index, end: command.index + text.length };
        uses.push(...configOptionUses(file, source, range, path.dirname(file)));
        const deploys = text.search(DEPLOY_COMMAND) !== -1;
        for (const match of text.matchAll(CONFIG_PATH_ENV)) {
          uses.push({
            file,
            ...lineAt(source, command.index),
            paths: splitPaths(match[2]!, path.dirname(file)),
            deploysTogether: deploys,
          });
        }
      }
      continue;
    }
    const isWorkflow = /(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/u.test(file);
    if (!isWorkflow && !/^\.env(?:\.|$)/u.test(name)) continue;
    const source = cache.project.read(file) ?? "";
    const baseDir = isWorkflow ? path.join(path.dirname(file), "../..") : path.dirname(file);
    for (const line of source.matchAll(SHELL_LINE)) {
      if (/^\s*#/u.test(line[0])) continue;
      const range = { start: line.index, end: line.index + line[0].length };
      if (isWorkflow && /\btailor\b/u.test(line[0])) {
        uses.push(...configOptionUses(file, source, range, baseDir));
      }
      for (const match of line[0].matchAll(CONFIG_PATH_ENV)) {
        uses.push({
          file,
          ...lineAt(source, range.start + match.index),
          paths: splitPaths(match[2]!, baseDir),
          deploysTogether: true,
        });
      }
    }
  }
  return uses;
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  find(key: string): string {
    let root = key;
    while (this.parent.has(root) && this.parent.get(root) !== root) root = this.parent.get(root)!;
    this.parent.set(key, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootB, rootA);
  }
}

function owner(configs: ConfigModule[], ref: ServiceRef): ConfigModule | undefined {
  return configs.find((config) =>
    config.services.some(
      (candidate) =>
        !candidate.external && candidate.service === ref.service && candidate.name === ref.name,
    ),
  );
}

/**
 * How a report names a service, such as `db namespace "main"` or `Auth service "shop-auth"`.
 * @param ref - The service
 * @returns Its description
 */
function describeService(ref: ServiceRef): string {
  const name = ref.name === null ? "" : ` "${ref.name}"`;
  switch (ref.service) {
    case "db":
    case "resolver":
      return `${ref.service} namespace${name}`;
    case "auth":
      return `Auth service${name}`;
    case "idp":
      return `IdP${name}`;
  }
}

function configAt(configs: ConfigModule[], configOrDir: string): ConfigModule | undefined {
  return configs.find((config) => config.path === configOrDir || config.dir === configOrDir);
}

/**
 * Group the configs that deploy to one workspace: a config declaring as external a service
 * another config defines, and configs one `tailor deploy`, `TAILOR_CONFIG_PATH`, or setup
 * target deploys together.
 * @param configs - The project's `defineConfig()` configs
 * @param uses - Where scripts and workflows name config paths
 * @param lock - The lock file, if any
 * @returns The groups, in the order of their first member
 */
export function groupConfigs(
  configs: ConfigModule[],
  uses: ConfigPathUse[],
  lock: Lock | null,
  exists: (relativePath: string) => boolean,
): ConfigGroup[] {
  const groups = new UnionFind();
  const blockers = new Map<string, Report[]>();
  const block = (config: ConfigModule, report: Report) => {
    blockers.set(config.path, [...(blockers.get(config.path) ?? []), report]);
  };

  for (const config of configs) {
    groups.find(config.path);
    for (const ref of config.services) {
      if (!ref.external) continue;
      const defining = ref.name === null ? undefined : owner(configs, ref);
      if (defining) groups.union(config.path, defining.path);
      else {
        const what = describeService(ref);
        block(config, {
          file: config.path,
          node: ref.node,
          message: `The ${what} is external, but no config in this project defines it, so the config was not converted.`,
        });
      }
    }
  }

  const together = [
    ...uses
      .filter((use) => use.deploysTogether)
      .map((use) => ({ paths: use.paths, source: `${use.file}:${use.line}` })),
    ...(lock?.multiConfigTargetDirs() ?? []).map((paths) => ({ paths, source: lock!.path })),
  ];
  for (const { paths, source } of together) {
    if (paths.length < 2) continue;
    const present = paths.flatMap((entry) => configAt(configs, entry) ?? []);
    for (const member of present.slice(1)) groups.union(present[0]!.path, member.path);
    if (present.length === 0) continue;
    const outside = paths.filter((entry) => entry.startsWith("../"));
    const unreadable = paths.filter(
      (entry) =>
        !entry.startsWith("../") &&
        configAt(configs, entry) === undefined &&
        (exists(entry) || exists(`${entry}/tailor.config.ts`)),
    );
    if (outside.length > 0) {
      block(present[0]!, {
        file: present[0]!.path,
        node: present[0]!.call,
        message: `${source} deploys this config together with ${outside.join(", ")}, outside the upgraded directory, so it was not converted. Run the upgrade from a directory that holds all of them.`,
      });
    }
    if (unreadable.length > 0) {
      block(present[0]!, {
        file: present[0]!.path,
        node: present[0]!.call,
        message: `${source} deploys this config together with ${unreadable.join(", ")}, which the conversion cannot read, so it was not converted.`,
      });
    }
  }

  const byRoot = new Map<string, ConfigGroup>();
  for (const config of configs) {
    const root = groups.find(config.path);
    const group = byRoot.get(root) ?? { members: [], blockers: [] };
    group.members.push(config);
    group.blockers.push(...(blockers.get(config.path) ?? []));
    byRoot.set(root, group);
  }
  return [...byRoot.values()];
}
