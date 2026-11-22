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
  /(?:^|[\s;&|("])(?:(?:npx|bunx|pnpm(?:\s+exec)?|yarn)\s+)?tailor\s+deploy\b([^;&|]*)/gu;
const CONFIG_OPTION = /(?:^|\s)(?:-c|--config)(?:=|\s+)(["']?)([^\s"']+)\1/gu;
const CONFIG_PATH_ENV = /\bTAILOR_CONFIG_PATH\s*[:=]\s*(["']?)([^\s"'#]+)\1/gu;

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
 * Find the scripts and workflows that name config paths: `-c`/`--config` in package.json scripts
 * and `TAILOR_CONFIG_PATH` in workflows and `.env` files.
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
        for (const option of text.matchAll(CONFIG_OPTION)) {
          if (!/\btailor\b/u.test(text)) continue;
          const deploy = [...text.matchAll(DEPLOY_COMMAND)].some((match) =>
            match[1]!.includes(option[0].trim()),
          );
          uses.push({
            file,
            ...lineAt(source, command.index),
            paths: splitPaths(option[2]!, path.dirname(file)),
            deploysTogether: deploy,
          });
        }
      }
      continue;
    }
    const isWorkflow = /(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/u.test(file);
    if (!isWorkflow && !/^\.env(?:\.|$)/u.test(name)) continue;
    const source = cache.project.read(file) ?? "";
    const baseDir = isWorkflow ? path.join(path.dirname(file), "../..") : path.dirname(file);
    for (const match of source.matchAll(CONFIG_PATH_ENV)) {
      uses.push({
        file,
        ...lineAt(source, match.index),
        paths: splitPaths(match[2]!, baseDir),
        deploysTogether: true,
      });
    }
  }
  return uses;
}

class Groups {
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
): ConfigGroup[] {
  const groups = new Groups();
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
        const what =
          ref.service === "db" || ref.service === "resolver"
            ? `${ref.service} namespace "${ref.name}"`
            : ref.service;
        block(config, {
          file: config.path,
          node: ref.node,
          message: `The ${what} is external, but no config in this project defines it, so the config was not converted.`,
        });
      }
    }
  }

  const together = [
    ...uses.filter((use) => use.deploysTogether).map((use) => ({ paths: use.paths, use })),
    ...(lock?.multiConfigTargetDirs() ?? []).map((paths) => ({ paths, use: undefined })),
  ];
  for (const { paths, use } of together) {
    if (paths.length < 2) continue;
    const members = paths.map((entry) => configAt(configs, entry));
    const present = members.filter((member): member is ConfigModule => member !== undefined);
    for (const member of present.slice(1)) groups.union(present[0]!.path, member.path);
    const outside = paths.filter((entry) => entry.startsWith("../"));
    if (outside.length > 0 && present.length > 0 && use) {
      block(present[0]!, {
        file: present[0]!.path,
        node: present[0]!.call,
        message: `${use.file}:${use.line} deploys this config together with ${outside.join(", ")}, outside the project directory, so it was not converted. Run the upgrade from the directory that holds all of them.`,
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
