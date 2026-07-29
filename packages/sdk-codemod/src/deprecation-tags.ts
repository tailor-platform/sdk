import { lte, valid } from "semver";

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
  /** Codemod ids registered in registry.ts. */
  codemodIds: ReadonlySet<string>;
  /** Current `@tailor-platform/sdk` version; a concrete `since` may not exceed it. */
  currentVersion: string;
}

// A tag's text runs to the end of its JSDoc comment or to the next block tag,
// whichever comes first.
const JSDOC_BLOCK = /\/\*\*[\s\S]*?\*\//g;
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

// One JSDoc block with its comment scaffolding removed, so a line is read the
// same way whether it opens the block, continues it, or closes it.
interface JsdocBlock {
  /** One-based line of the block's first line. */
  startLine: number;
  /** Block lines without `/**`, the leading `*`, or the trailing `*&#47;`. */
  lines: string[];
}

function jsdocBlocks(source: string): JsdocBlock[] {
  // Scan inside JSDoc blocks only, so `@deprecated` in a string literal or a
  // plain comment is not parsed as a tag.
  return [...source.matchAll(JSDOC_BLOCK)].map((block) => ({
    startLine: source.slice(0, block.index).split("\n").length,
    lines: block[0]
      .split("\n")
      .map((line, index) =>
        (index === 0
          ? line.replace(JSDOC_OPENER, "")
          : line.replace(JSDOC_LINE_PREFIX, "")
        ).replace(JSDOC_CLOSER, ""),
      ),
  }));
}

/**
 * Collect every `@deprecated` tag in a source file with its text. A tag is only
 * read where JSDoc reads one: at the start of its own line in the comment.
 * @param source - File contents
 * @returns One entry per `@deprecated` tag, in source order
 */
export function findDeprecationTags(source: string): DeprecationTag[] {
  const tags: DeprecationTag[] = [];
  for (const { startLine, lines } of jsdocBlocks(source)) {
    lines.forEach((line, index) => {
      const tag = DEPRECATED_TAG_LINE.exec(line);
      if (tag === null) return;

      const collected = [tag[1]!];
      for (const next of lines.slice(index + 1)) {
        if (NEXT_BLOCK_TAG.test(next)) break;
        collected.push(next);
      }

      tags.push({
        line: startLine + index,
        text: collected.join(" ").replace(/\s+/g, " ").trim(),
      });
    });
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
      if (!options.codemodIds.has(id)) {
        problems.push({
          line: tag.line,
          message: `codemod \`${id}\` is not registered in packages/sdk-codemod/src/registry.ts`,
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

// Tolerates a JSDoc continuation between the tag and `since`, so an unusually
// wrapped comment still resolves instead of silently shipping the sentinel.
const PENDING_SINCE_PATTERN = new RegExp(
  `(@deprecated\\s+(?:\\*\\s*)?since\\s+)${PENDING_SINCE}\\b`,
  "g",
);

/**
 * Rewrite `@deprecated since NEXT_RELEASE` to a concrete version. Confined to
 * JSDoc blocks, like {@link findDeprecationTags}, so the release workflow never
 * edits the sentinel spelled out in a string literal or a plain comment.
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

  let changed = false;
  const updated = source.replace(JSDOC_BLOCK, (block) =>
    block.replace(PENDING_SINCE_PATTERN, (_match, prefix: string) => {
      changed = true;
      return `${prefix}${resolvedVersion}`;
    }),
  );

  return changed ? { changed, source: updated } : { changed: false, source };
}
