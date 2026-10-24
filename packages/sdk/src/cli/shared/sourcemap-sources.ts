import * as fs from "node:fs";
import { matchesGlob } from "node:path/posix";
import * as path from "pathe";
import type { InlineSourcemapProjectSources } from "#/configure/config/types";

/** The `buildOptions.inlineSourcemapProjectSources` setting, with the absolute directory its globs are relative to. */
export type ProjectSourcesFilter = Readonly<InlineSourcemapProjectSources> & {
  /** The directory containing the config file. The working directory when omitted. */
  root?: string;
};

/** The fields of a sourcemap that this module reads or rewrites. */
export interface SourcemapData {
  version: number;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
  names: string[];
  mappings: string;
}

/** Parameters for {@link omitSourcesContent}. */
export interface OmitSourcesContentParams {
  /** Sourcemap to read. It is never mutated. */
  map: SourcemapData;
  /** Installed packages whose embedded source text is kept. */
  keep: readonly string[];
}

/** Parameters for {@link omitProjectSourcesContent}. */
export interface OmitProjectSourcesContentParams {
  /** Sourcemap to read. It is never mutated. */
  map: SourcemapData;
  /** Which of the project's own sources keep their embedded text. */
  projectSources: ProjectSourcesFilter;
  /** Absolute directory the sourcemap's `sources` are relative to. */
  sourcesDir: string;
}

/** Parameters for {@link toInlineSourcemapCode}. */
export interface ToInlineSourcemapCodeParams {
  /** Bundled code, with or without a trailing `sourceMappingURL` reference. */
  code: string;
  /** Sourcemap to embed. */
  map: SourcemapData;
}

const SOURCEMAP_REFERENCE_REGEX = /\n*\/\/[#@]\s*sourceMappingURL=[^\n]*\s*$/;

// Written in two parts so a tool that scans built files for sourcemap comments does not mistake this literal for one.
const INLINE_SOURCEMAP_PREFIX =
  "//# source" + "MappingURL=data:application/json;charset=utf-8;base64,";

function pathSegments(source: string): string[] {
  return source.replaceAll("\\", "/").split("/");
}

/**
 * Whether a sourcemap source path is inside `node_modules`, including files that belong to no
 * package such as `node_modules/.prisma/client/index.js`.
 * @param source - A path from a sourcemap's `sources`
 * @returns True when the path has a `node_modules` segment
 */
export function isDependencySource(source: string): boolean {
  return pathSegments(source).includes("node_modules");
}

/**
 * Resolve the npm package a sourcemap source path belongs to.
 * @param source - A path from a sourcemap's `sources`
 * @returns The package name, or undefined when the path is outside `node_modules` or belongs to no package
 */
export function sourcePackageName(source: string): string | undefined {
  const segments = pathSegments(source);
  const index = segments.lastIndexOf("node_modules");
  if (index === -1) return undefined;

  const first = segments[index + 1];
  if (!first || first.startsWith(".")) return undefined;
  if (!first.startsWith("@")) return first;

  const second = segments[index + 2];
  return second ? `${first}/${second}` : undefined;
}

function isOmittedSource(source: string, keep: readonly string[]): boolean {
  if (!isDependencySource(source)) return false;
  const name = sourcePackageName(source);
  return name === undefined || !keep.includes(name);
}

/**
 * Drop the embedded source text of every installed package except the given ones from a sourcemap.
 * A file under `node_modules` that belongs to no package is always dropped.
 * `sources`, `names` and `mappings` are kept, so positions in stack traces still resolve.
 * @param params - The map and the packages to keep
 * @returns A new map, or the input map itself when it carries no source text
 */
export function omitSourcesContent(params: OmitSourcesContentParams): SourcemapData {
  const { map, keep } = params;
  if (!map.sourcesContent) return map;

  const sourcesContent = map.sourcesContent.map((content, index) => {
    const source = map.sources[index];
    return source !== undefined && isOmittedSource(source, keep) ? null : content;
  });
  return { ...map, sourcesContent };
}

// `sourcesDir` derives from the working directory, which the OS reports as a real path, while a config path may go through a symlink.
function realpathOrSelf(dir: string): string {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}

function keepsProjectSource(relativePath: string, filter: ProjectSourcesFilter): boolean {
  const matches = (globs: readonly string[]) =>
    globs.some((glob) => matchesGlob(relativePath, glob.replace(/^\.\//, "")));
  if (filter.include && !matches(filter.include)) return false;
  return !(filter.exclude && matches(filter.exclude));
}

/**
 * Drop the embedded source text of the project's own files from a sourcemap.
 * Sources under `node_modules` are left to {@link omitSourcesContent}.
 * @param params - The map, the filter selecting which project sources keep their text, and the directory the map's sources are relative to
 * @returns A new map, or the input map itself when the filter has no rule
 */
export function omitProjectSourcesContent(params: OmitProjectSourcesContentParams): SourcemapData {
  const { map, projectSources, sourcesDir } = params;
  if (!projectSources.include && !projectSources.exclude) return map;
  if (!map.sourcesContent) return map;

  const root = realpathOrSelf(projectSources.root ?? process.cwd());
  const sourcesContent = map.sourcesContent.map((content, index) => {
    const source = map.sources[index];
    if (source === undefined || isDependencySource(source)) return content;
    const projectPath = path.relative(root, path.resolve(sourcesDir, source));
    return keepsProjectSource(projectPath, projectSources) ? content : null;
  });
  return { ...map, sourcesContent };
}

/**
 * Embed a sourcemap into bundled code as an inline `sourceMappingURL` comment,
 * replacing any existing reference.
 * @param params - The code and the map to embed
 * @returns The code ending with an inline sourcemap
 */
export function toInlineSourcemapCode(params: ToInlineSourcemapCodeParams): string {
  const { code, map } = params;
  const encoded = Buffer.from(JSON.stringify(map)).toString("base64");
  const body = code.replace(SOURCEMAP_REFERENCE_REGEX, "");
  return `${body}\n\n${INLINE_SOURCEMAP_PREFIX}${encoded}`;
}

/** A bundled chunk as returned by the bundler. */
interface BundledChunk {
  code: string;
  map?: SourcemapData | null;
}

/** Parameters for {@link chunkCodeWithSourcemap}. */
export interface ChunkCodeWithSourcemapParams {
  /** The chunk built with an external sourcemap. */
  chunk: BundledChunk;
  /** Whether the code carries an inline sourcemap. */
  inlineSourcemap: boolean;
  /** Whether the inline sourcemap embeds the source text of installed packages: all of them, or only the listed packages. */
  dependencySources: boolean | readonly string[];
  /** Which of the project's own sources keep their embedded text. All of them when omitted. */
  projectSources?: ProjectSourcesFilter;
  /** Absolute directory the chunk's sourcemap `sources` are relative to. Rolldown's default output folder when omitted. */
  sourcesDir?: string;
}

/**
 * Produce the code to deploy for a bundled chunk.
 * With inline sourcemaps enabled, the map is embedded into the code after dropping the
 * source text of installed packages unless `dependencySources` is `true` or lists them,
 * and the text of project files that `projectSources` excludes.
 * @param params - The chunk and the sourcemap settings
 * @returns The chunk code, with the inline sourcemap when enabled
 */
export function chunkCodeWithSourcemap(params: ChunkCodeWithSourcemapParams): string {
  const {
    chunk,
    inlineSourcemap,
    dependencySources,
    projectSources = {},
    sourcesDir = path.join(process.cwd(), "dist"),
  } = params;
  if (!inlineSourcemap || !chunk.map) return chunk.code;

  const projectMap = omitProjectSourcesContent({ map: chunk.map, projectSources, sourcesDir });
  if (dependencySources === true)
    return toInlineSourcemapCode({ code: chunk.code, map: projectMap });

  const map = omitSourcesContent({ map: projectMap, keep: dependencySources || [] });
  return toInlineSourcemapCode({ code: chunk.code, map });
}
