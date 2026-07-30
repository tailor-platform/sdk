import { Lang, parse } from "@ast-grep/napi";
import { gte, lte, valid } from "semver";
import type { SgNode } from "@ast-grep/napi";

/**
 * Sentinel `since` value for a deprecation whose shipping version is not known
 * yet. The release workflow rewrites it to the version the release PR bumps
 * `@tailor-platform/sdk` to — see resolvePendingSince.
 */
export const PENDING_SINCE = "NEXT_RELEASE";

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

/**
 * Collect the JSDoc comments of a file. Comments come from the parser rather than
 * a text scan, so a `/** … *&#47;` that only exists inside a string or template
 * literal — the SDK emits generated code that way — is not read as a tag, and the
 * release resolver cannot rewrite runtime string contents.
 * @param source - File contents
 * @returns One entry per JSDoc comment, in source order
 */
function jsdocBlocks(source: string): JsdocBlock[] {
  let comments: SgNode[];
  try {
    comments = parse(Lang.Tsx, source)
      .root()
      .findAll({ rule: { kind: "comment" } })
      .filter((node) => node.text().startsWith("/**"));
  } catch {
    return [];
  }

  return comments.map((node) => {
    const raw = node.text();
    const start = node.range().start;
    return {
      startLine: start.line + 1,
      startIndex: start.index,
      raw,
      lines: stripScaffolding(raw),
    };
  });
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
 * @returns One entry per `@deprecated` tag, in source order
 */
export function findDeprecationTags(source: string): DeprecationTag[] {
  const tags: DeprecationTag[] = [];
  for (const block of jsdocBlocks(source)) {
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
 * @returns One-based lines carrying a mention that is not a block tag
 */
export function findMisplacedDeprecationMentions(source: string): number[] {
  const misplaced: number[] = [];
  for (const { startLine, lines } of jsdocBlocks(source)) {
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

  for (const tag of findDeprecationTags(source)) {
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

  for (const line of findMisplacedDeprecationMentions(source)) {
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
 * @returns The (possibly) rewritten source and whether it changed
 */
export function resolvePendingSince(
  source: string,
  resolvedVersion: string,
): ResolvePendingSinceResult {
  if (valid(resolvedVersion) === null) {
    throw new Error(`resolvedVersion must be a valid semver version: ${resolvedVersion}`);
  }

  let updated = "";
  let cursor = 0;
  for (const block of jsdocBlocks(source)) {
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
