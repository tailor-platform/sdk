const RELEASED_PATTERN = /^const RELEASED_TEMPLATE_VERSION = (\d+);$/m;
const CHANGED_PATTERN = /^const TEMPLATE_CHANGED_SINCE_RELEASE = (true|false);$/m;
const FINGERPRINT_PATTERN = /^\/\/ Released template fingerprint: ([0-9a-f]+)$/m;

export type TemplateVersionState = {
  /** `RELEASED_TEMPLATE_VERSION`: the last template version a release shipped. */
  releasedVersion: number;
  /** `TEMPLATE_CHANGED_SINCE_RELEASE`: whether a template change awaits the next release. */
  changedSinceRelease: boolean;
  /** Fingerprint of the templates as `releasedVersion` rendered them. */
  releasedFingerprint: string;
};

/**
 * Read the template version constants and the released fingerprint from a templates.ts source.
 * @param source - Contents of templates.ts
 * @returns The released version, whether a change is pending, and the released fingerprint
 */
export function readTemplateVersionState(source: string): TemplateVersionState {
  const released = RELEASED_PATTERN.exec(source);
  const changed = CHANGED_PATTERN.exec(source);
  if (!released || !changed) {
    throw new Error(
      "templates.ts must declare `const RELEASED_TEMPLATE_VERSION = <n>;` and `const TEMPLATE_CHANGED_SINCE_RELEASE = <true|false>;`",
    );
  }
  const fingerprint = FINGERPRINT_PATTERN.exec(source);
  if (!fingerprint) {
    throw new Error(
      "templates.ts must record `// Released template fingerprint: <hash>` for RELEASED_TEMPLATE_VERSION",
    );
  }
  return {
    releasedVersion: Number(released[1]),
    changedSinceRelease: changed[1] === "true",
    releasedFingerprint: fingerprint[1],
  };
}

/**
 * Explain how the pending flag disagrees with the rendered templates.
 * @param params - The pending flag, the released fingerprint, and the current fingerprint
 * @param params.changedSinceRelease - `TEMPLATE_CHANGED_SINCE_RELEASE`
 * @param params.releasedFingerprint - The fingerprint recorded when the last version was released
 * @param params.currentHash - Fingerprint of the templates as they render now
 * @returns A message describing the fix, or undefined when they agree
 */
export function templateVersionDrift(params: {
  changedSinceRelease: boolean;
  releasedFingerprint: string;
  currentHash: string;
}): string | undefined {
  const { changedSinceRelease, releasedFingerprint, currentHash } = params;
  const rendersAsReleased = currentHash === releasedFingerprint;
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
  /** The released template version, when `changed` is true. */
  version?: number;
};

/**
 * Release a pending template change in a templates.ts source: bump
 * `RELEASED_TEMPLATE_VERSION`, record the fingerprint it is released with, and clear
 * `TEMPLATE_CHANGED_SINCE_RELEASE`. A no-op when no template changed since the last release.
 * @param source - Current contents of templates.ts
 * @param currentHash - Fingerprint of the templates as they render now
 * @returns The (possibly) rewritten source and the released version
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
      .replace(FINGERPRINT_PATTERN, `// Released template fingerprint: ${currentHash}`)
      .replace(RELEASED_PATTERN, `const RELEASED_TEMPLATE_VERSION = ${String(version)};`)
      .replace(CHANGED_PATTERN, "const TEMPLATE_CHANGED_SINCE_RELEASE = false;"),
    version,
  };
}
