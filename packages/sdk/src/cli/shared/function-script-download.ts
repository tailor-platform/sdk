/**
 * Download a deployed function script from the function registry.
 *
 * Wraps the server-streaming `downloadFunctionRegistryScript` RPC and
 * concatenates content chunks into a single UTF-8 string.
 */

import type { OperatorClient } from "@/cli/shared/client";

/**
 * Translate a `FunctionExecution.scriptName` into the corresponding
 * function registry name used by `downloadFunctionRegistryScript`.
 *
 * The platform records executions under a script-name format that
 * differs from the registry name. Known mappings:
 *
 *   resolver:     `<namespace>.<name>.body.js`     -> `resolver--<namespace>--<name>`
 *   executor:     `<name>.operation.js`            -> `executor--<name>`
 *   workflow job: `<name>` (no extension)          -> `workflow--<name>`
 *   auth hook:    `<authName>.<hookPoint>.hook.js` -> `auth-hook--<authName>--<hookPoint>`
 *
 * Returns `null` for unrecognized formats (including ad-hoc test-run
 * scripts that are not stored in the registry).
 * @param scriptName - The `scriptName` field from a `FunctionExecution`
 * @returns The function registry name, or null when no mapping applies
 */
export function scriptNameToRegistryName(scriptName: string): string | null {
  // Resolver: `<namespace>.<name>.body.js`
  // Use a non-greedy match for namespace so a name containing dots is
  // grouped into `name`, mirroring how resolvers are registered.
  const resolverMatch = /^([^.]+)\.(.+)\.body\.js$/.exec(scriptName);
  if (resolverMatch) {
    const [, namespace, name] = resolverMatch;
    return `resolver--${namespace}--${name}`;
  }

  // Executor: `<name>.operation.js`
  const executorMatch = /^(.+)\.operation\.js$/.exec(scriptName);
  if (executorMatch) {
    const [, name] = executorMatch;
    return `executor--${name}`;
  }

  // Auth hook: `<authName>.<hookPoint>.hook.js`
  const authHookMatch = /^([^.]+)\.([^.]+)\.hook\.js$/.exec(scriptName);
  if (authHookMatch) {
    const [, authName, hookPoint] = authHookMatch;
    return `auth-hook--${authName}--${hookPoint}`;
  }

  // Workflow job: bare name (no extension).
  if (!scriptName.includes(".")) {
    return `workflow--${scriptName}`;
  }

  // Unknown format (ad-hoc test-run scripts, seed scripts, etc.) are
  // not in the registry; signal with null so the caller can fall back.
  return null;
}

/** Options for downloading a function registry script */
export interface DownloadFunctionScriptOptions {
  /** Operator client instance */
  client: OperatorClient;
  /** Workspace ID */
  workspaceId: string;
  /** Function name (matches FunctionExecution.scriptName) */
  name: string;
  /** Optional content hash for a specific version (defaults to current version) */
  contentHash?: string;
}

/**
 * Download a deployed function script.
 *
 * Returns the full bundled script content as a UTF-8 string, or null if
 * the download fails (script removed, network error, etc.). Errors are
 * swallowed so callers can fall back to a non-sourcemap display.
 * @param options - Download options
 * @returns Script content, or null on failure / empty response
 */
export async function downloadFunctionScript(
  options: DownloadFunctionScriptOptions,
): Promise<string | null> {
  const { client, workspaceId, name, contentHash } = options;
  try {
    const chunks: Uint8Array[] = [];
    for await (const response of client.downloadFunctionRegistryScript({
      workspaceId,
      name,
      contentHash,
    })) {
      if (response.payload.case === "chunk") {
        chunks.push(response.payload.value);
      }
    }
    if (chunks.length === 0) return null;
    return Buffer.concat(chunks).toString("utf-8");
  } catch {
    return null;
  }
}
