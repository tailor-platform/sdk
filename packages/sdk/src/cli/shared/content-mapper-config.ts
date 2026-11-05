import * as fs from "node:fs";
import { findUpSync } from "find-up-simple";
import { createFilesMatcher, parseTsconfig, type TsConfigJsonResolved } from "get-tsconfig";
import * as path from "pathe";
import { DEFAULT_CONFIG_PATH } from "./args";
import { TAILOR_FILE_EXTENSION } from "./tailor-file-extension";

interface ContentMapperEntry {
  package?: unknown;
  extensions?: unknown;
  options?: unknown;
}

interface Project {
  tsconfigPath: string;
  config: TsConfigJsonResolved;
}

const SDK_PACKAGE = "@tailor-platform/sdk";
const TSCONFIG = "tsconfig.json";

function isSdkMapper(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const { package: name, extensions } = entry as ContentMapperEntry;
  return (
    name === SDK_PACKAGE && Array.isArray(extensions) && extensions.includes(TAILOR_FILE_EXTENSION)
  );
}

function configOption(entry: ContentMapperEntry): string | undefined {
  const { options } = entry;
  const config =
    typeof options === "object" && options !== null
      ? (options as { config?: unknown }).config
      : undefined;
  return typeof config === "string" ? config : undefined;
}

function includes(tsconfigPath: string, file: string): Project | undefined {
  const config = parseTsconfig(tsconfigPath);
  return createFilesMatcher({ path: tsconfigPath, config })(file)
    ? { tsconfigPath, config }
    : undefined;
}

function referencedProject(tsconfigPath: string, file: string): Project | undefined {
  for (const { path: reference } of parseTsconfig(tsconfigPath).references ?? []) {
    const target = path.resolve(path.dirname(tsconfigPath), reference);
    const referenced = target.endsWith(".json") ? target : path.join(target, TSCONFIG);
    try {
      const project = includes(referenced, file);
      if (project) return project;
    } catch {
      continue;
    }
  }
  return undefined;
}

function projectFor(file: string): Project | undefined {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    const tsconfigPath = path.join(dir, TSCONFIG);
    if (fs.existsSync(tsconfigPath)) {
      const project = includes(tsconfigPath, file) ?? referencedProject(tsconfigPath, file);
      if (project) return project;
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

/**
 * Tell whether the content mapper types a config file's project, so the
 * `tailor.d.ts` for it is not needed. The project is the one TypeScript's
 * language server picks: the nearest tsconfig.json that includes the file, or
 * that references a project which does, with `extends` resolved. The mapper
 * then reads the config its `config` option names, or else looks for
 * `tailor.config.ts` upward from that tsconfig's directory, so this is true
 * only when that is this very file.
 * @param configPath - Path of `tailor.config.ts`
 * @returns true when the mapper is enabled and resolves this config; false when it is not, resolves another file, or the tsconfig cannot be read
 */
export function isContentMapperEnabled(configPath: string): boolean {
  try {
    const file = path.resolve(configPath);
    const project = projectFor(file);
    if (!project) return false;
    const { contentMappers } = project.config as { contentMappers?: unknown };
    const entry = Array.isArray(contentMappers) ? contentMappers.find(isSdkMapper) : undefined;
    if (!entry) return false;
    const directory = path.dirname(project.tsconfigPath);
    const option = configOption(entry);
    const found =
      option === undefined
        ? findUpSync(DEFAULT_CONFIG_PATH, { cwd: directory })
        : path.resolve(directory, option);
    return found !== undefined && path.resolve(found) === file;
  } catch {
    return false;
  }
}
