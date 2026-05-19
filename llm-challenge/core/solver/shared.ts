/**
 * Patterns indicative of infrastructure failures the solver should treat as
 * "skip-and-continue" rather than real verification failures. Tuned for the
 * codex CLI path (codex-in-container + OpenAI API):
 *
 * - `401 Unauthorized` / `Authentication failed` / `codex login` — the auth
 *   file mounted from the host is missing, expired, or the subscription is
 *   no longer entitled.
 * - `429 Too Many Requests` / `rate limit` — ChatGPT subscription throttling.
 * - `ECONNREFUSED` / `ECONNRESET` / `ETIMEDOUT` / `socket hang up` /
 *   `network error` — transient network failure between the container and the
 *   OpenAI API.
 * - `OCI runtime` / `podman .* error` / `image .* not found` — Podman engine
 *   startup failures (image missing, machine not running).
 */
export const infraFailurePatterns = [
  /401 Unauthorized/,
  /Authentication failed/i,
  /codex login/i,
  /429 Too Many Requests/,
  /rate limit/i,
  /ECONNREFUSED/,
  /ECONNRESET/,
  /ETIMEDOUT/,
  /socket hang up/i,
  /network error/i,
  /OCI runtime/,
  /podman .* error/i,
  /image .* not found/i,
];

export function detectInfraFailure(output: string): boolean {
  return infraFailurePatterns.some((pattern) => pattern.test(output));
}
