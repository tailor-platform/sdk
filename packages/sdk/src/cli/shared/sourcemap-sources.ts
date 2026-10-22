import { matchesGlob } from "node:path/posix";

/** Which of the project's own sources keep their embedded text, as globs relative to the project root. */
export interface ProjectSourcesFilter {
  /** Only matching sources keep their text. All sources when omitted. */
  include?: readonly string[];
  /** Matching sources lose their text, even when included. */
  exclude?: readonly string[];
}

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

/** An exact package name, a pattern tested against the package name, or a predicate on the package name. */
type SourcemapPackageSelector = string | RegExp | ((packageName: string) => boolean);

/** Parameters for {@link omitSourcesContent}. */
export interface OmitSourcesContentParams {
  /** Sourcemap to read. It is never mutated. */
  map: SourcemapData;
  /** Packages whose embedded source text is dropped. */
  exclude: readonly SourcemapPackageSelector[];
}

/** Parameters for {@link omitProjectSourcesContent}. */
export interface OmitProjectSourcesContentParams {
  /** Sourcemap to read. It is never mutated. */
  map: SourcemapData;
  /** Which of the project's own sources keep their embedded text. */
  projectSources: ProjectSourcesFilter;
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

/**
 * Resolve the npm package a sourcemap source path belongs to.
 * @param source - A path from a sourcemap's `sources`
 * @returns The package name, or undefined when the path is outside `node_modules`
 */
export function sourcePackageName(source: string): string | undefined {
  const segments = source.replaceAll("\\", "/").split("/");
  const index = segments.lastIndexOf("node_modules");
  if (index === -1) return undefined;

  const first = segments[index + 1];
  if (!first || first.startsWith(".")) return undefined;
  if (!first.startsWith("@")) return first;

  const second = segments[index + 2];
  return second ? `${first}/${second}` : undefined;
}

function isExcludedSource(source: string, exclude: readonly SourcemapPackageSelector[]): boolean {
  const name = sourcePackageName(source);
  if (name === undefined) return false;
  return exclude.some((selector) => {
    if (typeof selector === "string") return selector === name;
    if (typeof selector === "function") return selector(name);
    return name.search(selector) !== -1;
  });
}

/**
 * Drop the embedded source text of the given packages from a sourcemap.
 * `sources`, `names` and `mappings` are kept, so positions in stack traces still resolve.
 * @param params - The map and the packages to drop
 * @returns A new map, or the input map itself when there is nothing to drop
 */
export function omitSourcesContent(params: OmitSourcesContentParams): SourcemapData {
  const { map, exclude } = params;
  if (exclude.length === 0 || !map.sourcesContent) return map;

  const sourcesContent = map.sourcesContent.map((content, index) => {
    const source = map.sources[index];
    return source !== undefined && isExcludedSource(source, exclude) ? null : content;
  });
  return { ...map, sourcesContent };
}

function keepsProjectSource(source: string, filter: ProjectSourcesFilter): boolean {
  const normalized = source.replaceAll("\\", "/");
  const matches = (globs: readonly string[]) => globs.some((glob) => matchesGlob(normalized, glob));
  if (filter.include && !matches(filter.include)) return false;
  return !(filter.exclude && matches(filter.exclude));
}

/**
 * Drop the embedded source text of the project's own files from a sourcemap.
 * Sources under `node_modules` are left to {@link omitSourcesContent}.
 * @param params - The map and the filter selecting which project sources keep their text
 * @returns A new map, or the input map itself when the filter has no rule
 */
export function omitProjectSourcesContent(params: OmitProjectSourcesContentParams): SourcemapData {
  const { map, projectSources } = params;
  if (!projectSources.include && !projectSources.exclude) return map;
  if (!map.sourcesContent) return map;

  const sourcesContent = map.sourcesContent.map((content, index) => {
    const source = map.sources[index];
    if (source === undefined || sourcePackageName(source) !== undefined) return content;
    return keepsProjectSource(source, projectSources) ? content : null;
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
  const { chunk, inlineSourcemap, dependencySources, projectSources = {} } = params;
  if (!inlineSourcemap || !chunk.map) return chunk.code;

  const projectMap = omitProjectSourcesContent({ map: chunk.map, projectSources });
  if (dependencySources === true)
    return toInlineSourcemapCode({ code: chunk.code, map: projectMap });

  const kept = new Set(dependencySources || []);
  const map = omitSourcesContent({ map: projectMap, exclude: [(name) => !kept.has(name)] });
  return toInlineSourcemapCode({ code: chunk.code, map });
}
