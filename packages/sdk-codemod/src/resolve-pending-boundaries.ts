import { Lang, parse as parseSource } from "@ast-grep/napi";
import { parse } from "semver";

// Tolerant of whitespace and CRLF, not just the exact oxfmt-formatted spacing this file
// happens to use today, so a manual edit or formatter change doesn't stop this from matching.
const PENDING_USAGE_PATTERN = /prereleaseUntil\s*:\s*V2_NEXT_PENDING\s*,/g;
// Includes a preceding JSDoc block (if any) so a new constant is inserted above it,
// not between the comment and `V2_NEXT_PENDING` where it would attach to the wrong export.
const PENDING_DECLARATION_PATTERN =
  /(?:^[ \t]*\/\*\*[\s\S]*?\*\/\r?\n)?^[ \t]*export\s+const\s+V2_NEXT_PENDING\s*=\s*"pending";$/m;

export interface ResolvePendingBoundariesResult {
  /** Whether any `V2_NEXT_PENDING` usage was found and rewritten. */
  changed: boolean;
  /** The constant name usages were rewritten to, when `changed` is true. */
  constantName?: string;
  /** The rewritten registry.ts source. Identical to the input when `changed` is false. */
  source: string;
}

/**
 * Rewrite `prereleaseUntil: V2_NEXT_PENDING` usages in a registry.ts source to the
 * concrete `V<major>_NEXT_<n>` constant for a resolved release version, inserting that
 * constant's declaration if it doesn't already exist. A no-op when no usage is present.
 * @param source - Current contents of registry.ts
 * @param resolvedVersion - The version the release PR bumped `@tailor-platform/sdk` to (e.g. "2.0.0-next.5")
 * @returns The (possibly) rewritten source and whether it changed
 */
export function resolvePendingBoundaries(
  source: string,
  resolvedVersion: string,
): ResolvePendingBoundariesResult {
  if (!PENDING_USAGE_PATTERN.test(source)) {
    return { changed: false, source };
  }
  PENDING_USAGE_PATTERN.lastIndex = 0;

  const parsed = parse(resolvedVersion);
  if (parsed === null) {
    throw new Error(`resolvedVersion must be a valid semver version: ${resolvedVersion}`);
  }
  if (
    parsed.major === 2 &&
    parsed.minor === 0 &&
    parsed.patch === 0 &&
    parsed.prerelease.length === 0
  ) {
    // The release skipped straight from a prerelease to stable 2.0.0 without ever
    // resolving this sentinel. That's fine: reachesCodemodBoundary() in registry.ts
    // already treats a pending codemod as reached once the target hits the stable
    // `until` boundary, so no concrete V2_NEXT_N constant is needed for it to work.
    return { changed: false, source };
  }
  if (
    parsed.major !== 2 ||
    parsed.minor !== 0 ||
    parsed.patch !== 0 ||
    parsed.prerelease.length !== 2 ||
    parsed.prerelease[0] !== "next" ||
    typeof parsed.prerelease[1] !== "number"
  ) {
    throw new Error(
      `resolvedVersion must be a "2.0.0-next.N" prerelease to resolve V2_NEXT_PENDING: ${resolvedVersion}`,
    );
  }
  const constantName = `V${parsed.major}_NEXT_${parsed.prerelease[1]}`;

  let updated = source;
  const existingDeclaration = new RegExp(`^const\\s+${constantName}\\s*=\\s*"([^"]+)";$`, "m").exec(
    source,
  );
  if (existingDeclaration) {
    if (existingDeclaration[1] !== resolvedVersion) {
      throw new Error(
        `${constantName} is already declared as ${existingDeclaration[1]}, which does not match the resolved version ${resolvedVersion}`,
      );
    }
  } else {
    const declarationMatch = PENDING_DECLARATION_PATTERN.exec(updated);
    if (declarationMatch === null) {
      throw new Error("Could not find the V2_NEXT_PENDING declaration in registry.ts");
    }
    const eol = source.includes("\r\n") ? "\r\n" : "\n";
    updated = updated.replace(
      declarationMatch[0],
      `const ${constantName} = "${resolvedVersion}";${eol}${declarationMatch[0]}`,
    );
  }

  updated = updated.replace(PENDING_USAGE_PATTERN, `prereleaseUntil: ${constantName},`);

  return { changed: true, constantName, source: updated };
}

/**
 * Rewrite `until: NEXT_RELEASE` usages in a registry.ts source to the stable version the
 * release PR bumped `@tailor-platform/sdk` to. A no-op when no usage is present.
 * @param source - Current contents of registry.ts
 * @param resolvedVersion - The version the release PR bumped `@tailor-platform/sdk` to (e.g. "2.21.0")
 * @param previousVersion - The `@tailor-platform/sdk` version before the release PR's bump
 * @returns The (possibly) rewritten source and whether it changed
 */
export function resolveNextReleaseUntil(
  source: string,
  resolvedVersion: string,
  previousVersion: string | undefined,
): { changed: boolean; source: string } {
  const parsed = parse(resolvedVersion);
  if (parsed === null) {
    throw new Error(`resolvedVersion must be a valid semver version: ${resolvedVersion}`);
  }
  const root = parseSource(Lang.TypeScript, source).root();
  const pendingValues = root
    .findAll({ rule: { kind: "pair" } })
    .filter((pair) => pair.field("key")?.text() === "until")
    .map((pair) => pair.field("value"))
    .filter((value) => value?.kind() === "identifier" && value.text() === "NEXT_RELEASE");
  if (pendingValues.length === 0) {
    return { changed: false, source };
  }
  if (parsed.prerelease.length > 0) {
    throw new Error(
      `resolvedVersion must be a stable version to resolve until: NEXT_RELEASE: ${resolvedVersion}`,
    );
  }
  if (previousVersion === undefined) {
    throw new Error("previousVersion is required to resolve until: NEXT_RELEASE");
  }
  if (resolvedVersion === previousVersion) {
    throw new Error(
      `until: NEXT_RELEASE would resolve to ${resolvedVersion}, which was already the SDK version before this release; add an @tailor-platform/sdk changeset to the change that introduced it`,
    );
  }
  return {
    changed: true,
    source: root.commitEdits(pendingValues.map((value) => value!.replace(`"${resolvedVersion}"`))),
  };
}
