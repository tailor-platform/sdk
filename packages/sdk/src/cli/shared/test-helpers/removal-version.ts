import { major } from "semver";
import { expect } from "vitest";
import { readPackageJson } from "#/cli/shared/package-json";

/**
 * Asserts that a compatibility warning names the major version (`v<N>`) that
 * removes the behavior, and that the SDK has not reached that major yet.
 * @param message - Warning text that says the behavior is "removed in v<N>"
 */
export async function expectRemovalInFutureMajor(message: string): Promise<void> {
  const removalMajor = /\bremoved in v(\d+)\b/.exec(message)?.[1];
  expect(removalMajor, `"${message}" names no removal version`).toBeDefined();
  const { version } = await readPackageJson();
  expect(Number(removalMajor)).toBeGreaterThan(major(String(version)));
}
