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
const NEXT_BLOCK_TAG = /^@\w/;
const JSDOC_LINE_PREFIX = /^\s*\*\s?/;
const SINCE = /^since\s+(\S+)/;
// Bounded so the id list stops at the first token that cannot be an id, instead
// of swallowing the prose that follows it.
const CODEMOD_IDS = /codemod:\s*([a-z0-9][\w./-]*(?:\s*,\s*[a-z0-9][\w./-]*)*)/;
const TRAILING_PUNCTUATION = /[.,;:—-]+$/;

/**
 * Collect every `@deprecated` tag in a source file with its text.
 * @param source - File contents
 * @returns One entry per `@deprecated` tag, in source order
 */
export function findDeprecationTags(source: string): DeprecationTag[] {
  const tags: DeprecationTag[] = [];
  // Scan inside JSDoc blocks only, so `@deprecated` in a string literal or a
  // plain comment is not parsed as a tag.
  for (const block of source.matchAll(JSDOC_BLOCK)) {
    const body = block[0].slice(0, -"*/".length);
    for (const match of body.matchAll(/@deprecated\b/g)) {
      const [firstLine = "", ...rest] = body.slice(match.index + match[0].length).split("\n");
      const collected = [firstLine];
      for (const line of rest) {
        const stripped = line.replace(JSDOC_LINE_PREFIX, "");
        if (NEXT_BLOCK_TAG.test(stripped)) break;
        collected.push(stripped);
      }

      tags.push({
        line: source.slice(0, block.index + match.index).split("\n").length,
        text: collected.join(" ").replace(/\s+/g, " ").trim(),
      });
    }
  }
  return tags;
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

  return problems;
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
 * Rewrite `@deprecated since NEXT_RELEASE` to a concrete version.
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
  if (!PENDING_SINCE_PATTERN.test(source)) {
    return { changed: false, source };
  }
  PENDING_SINCE_PATTERN.lastIndex = 0;
  return { changed: true, source: source.replace(PENDING_SINCE_PATTERN, `$1${resolvedVersion}`) };
}
