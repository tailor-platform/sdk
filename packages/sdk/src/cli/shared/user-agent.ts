import { readPackageJson } from "./package-json";

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
  return `tailor-sdk/${packageJson.version ?? "unknown"}`;
}
