import { Lang, parse } from "@ast-grep/napi";
import { gte, lte, valid } from "semver";
import type { SgNode } from "@ast-grep/napi";

/**
 * Sentinel `since` value for a deprecation whose shipping version is not known
 * yet. The release workflow rewrites it to the version the release PR bumps
 * `@tailor-platform/sdk` to — see resolvePendingSince.
 */
export const PENDING_SINCE = "NEXT_RELEASE";

/**
 * SDK source files the tag rules cover. Not just `.ts`: the CLI ships its
 * TypeScript loader hook as `.mjs` with a hand-written `.d.mts`, and a
 * deprecation declared there is as public as one in a `.ts` file.
 */
export const SDK_SOURCE_GLOB = "src/**/*.{ts,mts,cts,js,mjs,cjs}";

/** A single `@deprecated` JSDoc tag found in a source file. */
export interface DeprecationTag {
  /** One-based line of the `@deprecated` tag. */
  line: number;
  /** Tag text after `@deprecated`, joined into one line with `*` prefixes stripped. */
  text: string;
}

/** A rule violation on one `@deprecated` tag. */
export interface DeprecationProblem {
  /** One-based line of the offending tag. */
  line: number;
  /** What is wrong and how to fix it. */
  message: string;
}

/** Inputs the tag rules are checked against. */
export interface CheckDeprecationTagsOptions {
  /**
   * Registered codemod ids mapped to the version that removes what they migrate
   * — `prereleaseUntil` when it names a concrete prerelease, `until` otherwise.
   */
  codemodBoundaries: ReadonlyMap<string, string>;
  /**
   * Current `@tailor-platform/sdk` version. A concrete `since` may not exceed it,
   * and a codemod boundary at or below it means the API was already due for removal.
   */
  currentVersion: string;
  /** Path the source came from, used to pick the grammar and to report locations. */
  filePath?: string;
}

// A tag's text runs to the end of its JSDoc comment or to the next block tag,
// whichever comes first.
const JSDOC_OPENER = /^[ \t]*\/\*\*/;
const JSDOC_CLOSER = /\*\/[ \t]*$/;
const JSDOC_LINE_PREFIX = /^\s*\*\s?/;
const DEPRECATED_TAG_LINE = /^[ \t]*@deprecated\b(.*)$/;
const NEXT_BLOCK_TAG = /^[ \t]*@\w/;
const INLINE_CODE = /`[^`]*`/g;
const SINCE = /^since\s+(\S+)/;
// Bounded so the id list stops at the first token that cannot be an id, instead
// of swallowing the prose that follows it.
const CODEMOD_IDS = /codemod:\s*([a-z0-9][\w./-]*(?:\s*,\s*[a-z0-9][\w./-]*)*)/;
const TRAILING_PUNCTUATION = /[.,;:—-]+$/;

/** One JSDoc comment, as raw lines plus the same lines with the scaffolding removed. */
interface JsdocBlock {
  /** One-based line of the comment's first line. */
  startLine: number;
  /** Character offset of the comment in the file. */
  startIndex: number;
  /** Comment text exactly as it appears in the file. */
  raw: string;
  /** `raw` split by line, without `/**`, the leading `*`, or the trailing `*&#47;`. */
  lines: string[];
}

function stripScaffolding(raw: string): string[] {
  return raw
    .split("\n")
    .map((line, index) =>
      (index === 0 ? line.replace(JSDOC_OPENER, "") : line.replace(JSDOC_LINE_PREFIX, "")).replace(
        JSDOC_CLOSER,
        "",
      ),
    );
}

/** A file's JSDoc comments, plus whether the parse was clean enough to trust. */
interface ParsedSource {
  blocks: JsdocBlock[];
  /**
   * The grammar could not parse part of the file. Comments inside such a region
   * are dropped, so absence of a tag there is not evidence there is none.
   */
  degraded: boolean;
}

/**
 * `<string>value` is a type assertion in `.ts` and JSX in `.tsx`, so reading a
 * `.ts` file with the TSX grammar drops the comments around one — a real tag
 * would go unseen. Pick the grammar the file is actually written in.
 * @param filePath - Path the source came from, when known
 * @returns The grammar to parse with
 */
function sourceLang(filePath: string | undefined): Lang {
  return filePath !== undefined && /\.[jt]sx$/.test(filePath) ? Lang.Tsx : Lang.TypeScript;
}

/**
 * Collect the JSDoc comments of a file. Comments come from the parser rather than
 * a text scan, so a `/** … *&#47;` that only exists inside a string or template
 * literal — the SDK emits generated code that way — is not read as a tag, and the
 * release resolver cannot rewrite runtime string contents.
 * @param source - File contents
 * @param filePath - Path the source came from, used to pick the grammar
 * @returns The comments and whether the parse was degraded
 * @throws When the source cannot be parsed at all, so callers fail loudly rather
 *   than treating an unreadable file as one with no deprecations
 */
function parseSource(source: string, filePath?: string): ParsedSource {
  const root = parse(sourceLang(filePath), source).root();
  const blocks = root
    .findAll({ rule: { kind: "comment" } })
    .filter((node: SgNode) => node.text().startsWith("/**"))
    .map((node: SgNode) => {
      const raw = node.text();
      const start = node.range().start;
      return {
        startLine: start.line + 1,
        startIndex: start.index,
        raw,
        lines: stripScaffolding(raw),
      };
    });

  return { blocks, degraded: root.find({ rule: { kind: "ERROR" } }) !== null };
}

function jsdocBlocks(source: string, filePath?: string): JsdocBlock[] {
  return parseSource(source, filePath).blocks;
}

// Matches both comment shapes a tag is written in: the `/** @deprecated …` opener
// and a ` * @deprecated …` continuation.
const TAG_LOOKING_LINE = /^[ \t]*(?:\/\*\*|\*)?[ \t]*@deprecated\b/;

/**
 * When the grammar could not parse part of the file, a line that looks like a
 * tag but sits outside every recognized comment may be a real tag the parser
 * dropped. Report those rather than treating the gap as "no deprecation". Only
 * used on a degraded parse: on a clean one the parser is the authority, which is
 * what keeps a JSDoc inside a template literal correctly ignored.
 * @param source - File contents
 * @param tags - Tags the parser did find
 * @returns One problem per tag-looking line the parse cannot account for
 */
function unverifiableTagLines(source: string, tags: DeprecationTag[]): DeprecationProblem[] {
  const found = new Set(tags.map((tag) => tag.line));
  const problems: DeprecationProblem[] = [];
  source.split("\n").forEach((line, index) => {
    if (!TAG_LOOKING_LINE.test(line) || found.has(index + 1)) return;
    problems.push({
      line: index + 1,
      message:
        "looks like a `@deprecated` tag but the parser could not read this part of the file, so the rules could not be checked here; fix the syntax the grammar rejects, or move the declaration to a file it can parse",
    });
  });
  return problems;
}

/** Line indexes (within a block) that start a `@deprecated` tag, with its text. */
function deprecationTagsInBlock(block: JsdocBlock): Array<{ index: number; text: string }> {
  const tags: Array<{ index: number; text: string }> = [];
  block.lines.forEach((line, index) => {
    const tag = DEPRECATED_TAG_LINE.exec(line);
    if (tag === null) return;
    const collected = [tag[1]!];
    for (const next of block.lines.slice(index + 1)) {
      if (NEXT_BLOCK_TAG.test(next)) break;
      collected.push(next);
    }
    tags.push({ index, text: collected.join(" ").replace(/\s+/g, " ").trim() });
  });
  return tags;
}

/**
 * Collect every `@deprecated` tag in a source file with its text. A tag is only
 * read where JSDoc reads one: at the start of its own line in the comment.
 * @param source - File contents
 * @param filePath - Path the source came from, used to pick the grammar
 * @returns One entry per `@deprecated` tag, in source order
 */
export function findDeprecationTags(source: string, filePath?: string): DeprecationTag[] {
  const tags: DeprecationTag[] = [];
  for (const block of jsdocBlocks(source, filePath)) {
    for (const tag of deprecationTagsInBlock(block)) {
      tags.push({ line: block.startLine + tag.index, text: tag.text });
    }
  }
  return tags;
}

/**
 * Find `@deprecated` written mid-line inside a JSDoc block, where JSDoc does
 * not read it as a block tag. Reported rather than ignored: silently skipping it
 * would let a real deprecation escape the check. Prose *about* the tag is
 * excluded by writing it as inline code.
 * @param source - File contents
 * @param filePath - Path the source came from, used to pick the grammar
 * @returns One-based lines carrying a mention that is not a block tag
 */
export function findMisplacedDeprecationMentions(source: string, filePath?: string): number[] {
  const misplaced: number[] = [];
  for (const { startLine, lines } of jsdocBlocks(source, filePath)) {
    lines.forEach((line, index) => {
      if (DEPRECATED_TAG_LINE.test(line)) return;
      if (!line.replace(INLINE_CODE, "").includes("@deprecated")) return;
      misplaced.push(startLine + index);
    });
  }
  return misplaced;
}

/**
 * Check `@deprecated` tags against the deprecation process rules: each tag
 * states the version it was deprecated in (or the {@link PENDING_SINCE}
 * sentinel while that version is unknown) and names the codemod that migrates
 * callers off it.
 * @param source - File contents
 * @param options - Registered codemod ids and the current package version
 * @returns One problem per violation; empty when every tag is well-formed
 */
export function checkDeprecationTags(
  source: string,
  options: CheckDeprecationTagsOptions,
): DeprecationProblem[] {
  const problems: DeprecationProblem[] = [];

  let parsed: ParsedSource;
  try {
    parsed = parseSource(source, options.filePath);
  } catch (error) {
    // Reading nothing out of an unparseable file must not read as "no
    // deprecations here" — that is how an unenforced tag would ship.
    return [
      {
        line: 1,
        message: `could not be parsed, so its \`@deprecated\` tags could not be checked: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }

  const tags = parsed.blocks.flatMap((block) =>
    deprecationTagsInBlock(block).map((tag) => ({
      line: block.startLine + tag.index,
      text: tag.text,
    })),
  );

  if (parsed.degraded) {
    problems.push(...unverifiableTagLines(source, tags));
  }

  for (const tag of tags) {
    const since = SINCE.exec(tag.text);
    if (since === null) {
      problems.push({
        line: tag.line,
        message: `@deprecated must start with \`since <version>\`, using \`${PENDING_SINCE}\` while the shipping version is unknown`,
      });
    } else {
      const version = since[1]!.replace(TRAILING_PUNCTUATION, "");
      if (version !== PENDING_SINCE) {
        if (valid(version) === null) {
          problems.push({
            line: tag.line,
            message: `\`since ${version}\` is not a semver version; write the released version or \`${PENDING_SINCE}\``,
          });
        } else if (!lte(version, options.currentVersion)) {
          problems.push({
            line: tag.line,
            message: `\`since ${version}\` is newer than the current version ${options.currentVersion}; write \`${PENDING_SINCE}\` and let the release workflow resolve it`,
          });
        }
      }
    }

    const ids = CODEMOD_IDS.exec(tag.text);
    if (ids === null) {
      problems.push({
        line: tag.line,
        message:
          "@deprecated must name the migration with `codemod: <id>`; register an entry in packages/sdk-codemod/src/registry.ts (a manual migration ships `suspiciousPatterns` + `prompt` without `scriptPath`)",
      });
      continue;
    }

    for (const id of ids[1]!
      .split(",")
      .map((value) => value.trim().replace(TRAILING_PUNCTUATION, ""))) {
      const boundary = options.codemodBoundaries.get(id);
      if (boundary === undefined) {
        problems.push({
          line: tag.line,
          message: `codemod \`${id}\` is not registered in packages/sdk-codemod/src/registry.ts`,
        });
        continue;
      }
      // The codemod migrates callers off an API that this release no longer has,
      // so the declaration should have gone with it. Catches a removal that was
      // planned, automated, and then forgotten.
      if (gte(options.currentVersion, boundary)) {
        problems.push({
          line: tag.line,
          message: `\`${id}\` migrates callers off this API as of ${boundary}, which ${options.currentVersion} has reached; delete the deprecated declaration, or point the tag at the codemod for the release that removes it`,
        });
      }
    }
  }

  for (const line of findMisplacedDeprecationMentions(source, options.filePath)) {
    problems.push({
      line,
      message:
        "`@deprecated` must start its own JSDoc line to be read as a tag; write it as inline code (`` `@deprecated` ``) when the text is only prose about deprecation",
    });
  }

  return problems.toSorted((left, right) => left.line - right.line);
}

/** Outcome of rewriting the pending `since` sentinel in one file. */
export interface ResolvePendingSinceResult {
  /** Whether any sentinel was rewritten. */
  changed: boolean;
  /** The rewritten source; identical to the input when `changed` is false. */
  source: string;
}

const PENDING_SINCE_VALUE = new RegExp(`^since\\s+${PENDING_SINCE}\\b`);

/**
 * Rewrite one JSDoc comment's pending sentinels, or return null when it has none.
 * Which tags to touch comes from the same parse the checker uses, so a tag the
 * checker accepts cannot be one the resolver silently skips — the sentinel is then
 * replaced in the tag's own lines, wherever the wrapping happens to have put it.
 * @param block - The JSDoc comment
 * @param resolvedVersion - Version to write in place of the sentinel
 * @returns The rewritten comment text, or null when nothing matched
 */
function rewriteBlock(block: JsdocBlock, resolvedVersion: string): string | null {
  const rawLines = block.raw.split("\n");
  let changed = false;

  for (const tag of deprecationTagsInBlock(block)) {
    if (!PENDING_SINCE_VALUE.test(tag.text)) continue;
    const lastLine = block.lines.findIndex(
      (line, index) => index > tag.index && NEXT_BLOCK_TAG.test(line),
    );
    const end = lastLine === -1 ? rawLines.length : lastLine;
    for (let index = tag.index; index < end; index += 1) {
      if (!rawLines[index]!.includes(PENDING_SINCE)) continue;
      rawLines[index] = rawLines[index]!.replace(PENDING_SINCE, resolvedVersion);
      changed = true;
      break;
    }
  }

  return changed ? rawLines.join("\n") : null;
}

/**
 * Rewrite `@deprecated since NEXT_RELEASE` to a concrete version, in JSDoc
 * comments only, so the release workflow never edits a sentinel that is part of a
 * string literal or a plain comment.
 * @param source - File contents
 * @param resolvedVersion - Version the release PR bumped `@tailor-platform/sdk` to
 * @param filePath - Path the source came from, used to pick the grammar
 * @returns The (possibly) rewritten source and whether it changed
 */
export function resolvePendingSince(
  source: string,
  resolvedVersion: string,
  filePath?: string,
): ResolvePendingSinceResult {
  if (valid(resolvedVersion) === null) {
    throw new Error(`resolvedVersion must be a valid semver version: ${resolvedVersion}`);
  }

  let updated = "";
  let cursor = 0;
  for (const block of jsdocBlocks(source, filePath)) {
    const rewritten = rewriteBlock(block, resolvedVersion);
    if (rewritten === null) continue;
    updated += source.slice(cursor, block.startIndex) + rewritten;
    cursor = block.startIndex + block.raw.length;
  }

  if (cursor === 0) {
    return { changed: false, source };
  }
  return { changed: true, source: updated + source.slice(cursor) };
}
