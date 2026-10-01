const RELEASED_PATTERN = /^const RELEASED_TEMPLATE_VERSION = (\d+);$/m;
const CHANGED_PATTERN = /^const TEMPLATE_CHANGED_SINCE_RELEASE = (true|false);$/m;

export type TemplateFingerprint = {
  /** The template version these templates were released as. */
  version: number;
  /** Fingerprint of the templates rendered at that version. */
  hash: string;
};

export type TemplateVersionState = {
  /** `RELEASED_TEMPLATE_VERSION`: the last template version a release shipped. */
  releasedVersion: number;
  /** `TEMPLATE_CHANGED_SINCE_RELEASE`: whether a template change awaits the next release. */
  changedSinceRelease: boolean;
};

/**
 * Read the template version constants from a templates.ts source.
 * @param source - Contents of templates.ts
 * @returns The released version and whether a change is pending
 */
export function readTemplateVersionState(source: string): TemplateVersionState {
  const released = RELEASED_PATTERN.exec(source);
  const changed = CHANGED_PATTERN.exec(source);
  if (!released || !changed) {
    throw new Error(
      "templates.ts must declare `const RELEASED_TEMPLATE_VERSION = <n>;` and `const TEMPLATE_CHANGED_SINCE_RELEASE = <true|false>;`",
    );
  }
  return { releasedVersion: Number(released[1]), changedSinceRelease: changed[1] === "true" };
}

/**
 * Explain how the template version constants disagree with the rendered templates.
 * @param params - The constants, the recorded fingerprint, and the current fingerprint
 * @param params.releasedVersion - `RELEASED_TEMPLATE_VERSION`
 * @param params.changedSinceRelease - `TEMPLATE_CHANGED_SINCE_RELEASE`
 * @param params.recorded - The fingerprint recorded when that version was released
 * @param params.currentHash - Fingerprint of the templates as they render now
 * @returns A message describing the fix, or undefined when they agree
 */
export function templateVersionDrift(params: {
  releasedVersion: number;
  changedSinceRelease: boolean;
  recorded: TemplateFingerprint;
  currentHash: string;
}): string | undefined {
  const { releasedVersion, changedSinceRelease, recorded, currentHash } = params;
  if (recorded.version !== releasedVersion) {
    return `template-fingerprint.json records version ${String(recorded.version)}, but RELEASED_TEMPLATE_VERSION is ${String(releasedVersion)}. Only the release PR updates either of them.`;
  }
  const rendersAsReleased = currentHash === recorded.hash;
  if (!changedSinceRelease && !rendersAsReleased) {
    return "The generated templates changed since the last release. Set `const TEMPLATE_CHANGED_SINCE_RELEASE = true;` in templates.ts so the next release bumps TEMPLATE_VERSION.";
  }
  if (changedSinceRelease && rendersAsReleased) {
    return "The generated templates render exactly as last released. Set `const TEMPLATE_CHANGED_SINCE_RELEASE = false;` in templates.ts so the next release does not bump TEMPLATE_VERSION.";
  }
  return undefined;
}

export type ResolvePendingTemplateVersionResult = {
  /** Whether a template change was pending and is now released. */
  changed: boolean;
  /** The (possibly) rewritten templates.ts source. */
  source: string;
  /** The fingerprint to record for the released version, when `changed` is true. */
  fingerprint?: TemplateFingerprint;
};

/**
 * Release a pending template change in a templates.ts source: bump
 * `RELEASED_TEMPLATE_VERSION` and clear `TEMPLATE_CHANGED_SINCE_RELEASE`.
 * A no-op when no template changed since the last release.
 * @param source - Current contents of templates.ts
 * @param currentHash - Fingerprint of the templates as they render now
 * @returns The (possibly) rewritten source and the fingerprint to record
 */
export function resolvePendingTemplateVersion(
  source: string,
  currentHash: string,
): ResolvePendingTemplateVersionResult {
  const { releasedVersion, changedSinceRelease } = readTemplateVersionState(source);
  if (!changedSinceRelease) {
    return { changed: false, source };
  }
  const version = releasedVersion + 1;
  return {
    changed: true,
    source: source
      .replace(RELEASED_PATTERN, `const RELEASED_TEMPLATE_VERSION = ${String(version)};`)
      .replace(CHANGED_PATTERN, "const TEMPLATE_CHANGED_SINCE_RELEASE = false;"),
    fingerprint: { version, hash: currentHash },
  };
}
