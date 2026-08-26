import {
  WAIT_POINT_KEY_GRAMMAR as KEY_GRAMMAR,
  WAIT_POINT_KEY_MAX_LENGTH as MAX_KEY_LENGTH,
  WAIT_POINT_KEY_REGEX as KEY_REGEX,
  isWaitPointParamSegment,
} from "#/utils/wait-point-key-grammar";
import type { RegisteredWaitPoint } from "#/utils/wait-point-registry";

const LITERAL_SEGMENT_REGEX = /^[a-z0-9]+$/;
const PARAM_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Check one declared wait point key against the key rules.
 *
 * The declaration matters: only `createWaitPoints`' `define` receives the key
 * before the type arguments, so only there can TypeScript read the `$params`
 * off the key literal.
 * @param waitPoint - A key as declared, with the declaration it came from
 * @returns The rule the key breaks, or undefined when the key is usable
 */
export function checkWaitPointKey(waitPoint: RegisteredWaitPoint): string | undefined {
  const { key, declaredBy } = waitPoint;
  const segments = key.split("-");
  // Excluding bare "$" matters here: otherwise a key carrying one would be
  // answered with advice about typing its $params.
  const paramSegments = segments.filter(isWaitPointParamSegment);

  if (paramSegments.length > 0 && declaredBy !== "define") {
    return declaredBy === "property"
      ? `Invalid wait point key "${key}": $params cannot come from a property name. Pass the key to define instead, e.g. define.for("${key}")<Payload, Result>().`
      : `Invalid wait point key "${key}": createWaitPoint takes its type arguments first, which stops TypeScript inferring the key as a literal, so it cannot type the $params. Declare it through createWaitPoints instead: createWaitPoints((define) => ({ myWaitPoint: define.for("${key}")<Payload, Result>() })).`;
  }

  const seen = new Set<string>();
  let literals = 0;

  for (const segment of segments) {
    if (segment.startsWith("$")) {
      const name = segment.slice(1);
      if (!PARAM_NAME_REGEX.test(name)) {
        return `Invalid wait point key "${key}": "${segment}" is not a usable parameter name. Use letters, digits and underscores, starting with a letter or underscore.`;
      }
      if (seen.has(name)) {
        return `Invalid wait point key "${key}": parameter "$${name}" appears more than once.`;
      }
      seen.add(name);
      continue;
    }
    // An empty segment comes from a run of hyphens, which the key grammar allows
    // inside a key. Leave the placement rules to the whole-key checks below.
    if (segment === "") continue;
    if (!LITERAL_SEGMENT_REGEX.test(segment)) {
      return `Invalid wait point key "${key}": segment "${segment}" may only contain [a-z0-9]. Wait point keys accept ${KEY_GRAMMAR}, with $params standing in for runtime values.`;
    }
    literals += 1;
  }

  // Only a key that actually carries $params can be identity-less in this
  // sense; without them, an empty run of segments is a plain grammar failure.
  if (literals === 0 && paramSegments.length > 0) {
    // A key that also sits outside the grammar needs to hear that first:
    // adding the literal this message asks for would leave "-$id" broken.
    return key.startsWith("-") || key.endsWith("-")
      ? `Invalid wait point key "${key}": must match ${KEY_GRAMMAR}.`
      : `Invalid wait point key "${key}": it needs at least one literal segment alongside its $params, otherwise the key carries no identity of its own and can collide with an unrelated wait point.`;
  }

  if (paramSegments.length === 0) {
    return KEY_REGEX.test(key)
      ? undefined
      : `Invalid wait point key "${key}": must match ${KEY_GRAMMAR}.`;
  }

  // Every param value is itself `[a-z0-9]`-bounded, so the shortest instance of
  // the pattern is valid exactly when every instance is.
  const shortest = segments.map((segment) => (segment.startsWith("$") ? "0" : segment)).join("-");
  if (shortest.length > MAX_KEY_LENGTH) {
    return `Wait point key "${key}" cannot fit in ${MAX_KEY_LENGTH} characters: even single-character parameter values produce ${shortest.length}.`;
  }
  return KEY_REGEX.test(shortest)
    ? undefined
    : `Invalid wait point key "${key}": must match ${KEY_GRAMMAR}.`;
}

/**
 * Check every declared wait point key, reporting each broken rule once.
 * @param waitPoints - The keys declared across the project, as registered
 * @returns One message per distinct declaration that breaks a rule
 */
export function collectWaitPointKeyFailures(waitPoints: readonly RegisteredWaitPoint[]): string[] {
  const failures: string[] = [];
  // The declaration is half of what makes a key valid, so the same key
  // declared two ways is two things to check, not one.
  const seen = new Set<string>();
  for (const waitPoint of waitPoints) {
    const identity = `${waitPoint.declaredBy} ${waitPoint.key}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const failure = checkWaitPointKey(waitPoint);
    if (failure) failures.push(failure);
  }
  return failures;
}
