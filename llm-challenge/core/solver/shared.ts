/**
 * Patterns indicative of infrastructure failures the solver should treat as
 * "skip-and-continue" rather than real verification failures. Tuned for the
 * OSS path (opencode-in-container + host Ollama):
 *
 * - `ECONNREFUSED` / `ECONNRESET` / `ETIMEDOUT` / `socket hang up` — Ollama
 *   not running, crashed, or unreachable from inside the container.
 * - `model.*not found` / `pull model manifest` — requested model is not
 *   downloaded on the host.
 * - `failed to load model` / `out of memory` / `CUDA error` — Ollama runtime
 *   failures during inference (typically OOM or GPU-side errors).
 * - `podman` / `OCI runtime` / `image.*not found` — container engine startup
 *   failures.
 */
export const infraFailurePatterns = [
  /ECONNREFUSED/,
  /ECONNRESET/,
  /ETIMEDOUT/,
  /socket hang up/i,
  /model .* not found/i,
  /no such model/i,
  /pull model manifest/i,
  /failed to load model/i,
  /out of memory/i,
  /CUDA error/i,
  /OCI runtime/i,
  /podman .* error/i,
  /image .* not found/i,
];

export function detectInfraFailure(output: string): boolean {
  return infraFailurePatterns.some((pattern) => pattern.test(output));
}
