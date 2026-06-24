import { readPackageJson } from "./package-json";

/**
 * Build the User-Agent string from an already-known SDK version, without
 * touching the filesystem. Use this when the caller has resolved the version
 * (e.g. crash reporting already reads `package.json`) to avoid a redundant read.
 * @param version - SDK version string
 * @returns User-Agent header value
 */
export function userAgentFromVersion(version: string): string {
  return `tailor-sdk/${version}`;
}

/**
 * Build the User-Agent string for CLI requests.
 *
 * Lives in its own module (rather than `client.ts`) so callers that only need
 * the UA — e.g. crash reporting — do not pull in the operator client's heavy
 * OAuth2/Connect/Protobuf dependencies, and so importing it never forms a cycle.
 * @returns User-Agent header value
 */
export async function userAgent() {
  const packageJson = await readPackageJson();
  return userAgentFromVersion(packageJson.version ?? "unknown");
}
