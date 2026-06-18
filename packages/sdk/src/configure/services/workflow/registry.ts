import type { TailorEnv, TailorPrincipal } from "@/runtime/types";

/**
 * Body signature shared by workflow jobs at registry-write time.
 * The user's `createWorkflowJob`/`createWorkflow` body uses concrete types,
 * but the registry erases them for storage.
 */
export type RegisteredJobBody = (
  args: unknown,
  context: { env: TailorEnv; invoker: TailorPrincipal | null },
) => unknown | Promise<unknown>;

const JOB_REGISTRY_KEY: unique symbol = Symbol.for("tailor-platform/sdk:job-registry");

type PlatformWorkflow = {
  triggerWorkflow: (name: string, args?: unknown, options?: unknown) => Promise<string>;
  triggerJobFunction: (name: string, args?: unknown) => unknown;
};

type GlobalWithRegistry = typeof globalThis & {
  [JOB_REGISTRY_KEY]?: Map<string, RegisteredJobBody>;
  tailor?: { workflow?: PlatformWorkflow };
};

function jobs(): Map<string, RegisteredJobBody> {
  const g = globalThis as GlobalWithRegistry;
  let map = g[JOB_REGISTRY_KEY];
  if (!map) {
    map = new Map();
    g[JOB_REGISTRY_KEY] = map;
  }
  return map;
}

/**
 * Register a job body keyed by job name. Called as a side effect by
 * `createWorkflowJob` so `runWorkflowLocally()` can execute dependent job
 * bodies when `globalThis.tailor.workflow.triggerJobFunction(name, args)` is invoked.
 *
 * In production builds the bundler rewrites `.trigger()` calls so this registry
 * is never read; the gated write is dropped as dead code.
 * @param name - Job name
 * @param body - Job body function
 */
export function registerJob(name: string, body: RegisteredJobBody): void {
  jobs().set(name, body);
}

/**
 * Look up a registered job body by name.
 * @param name - Job name
 * @returns The registered body, or undefined when no job is registered
 */
export function getRegisteredJob(name: string): RegisteredJobBody | undefined {
  return jobs().get(name);
}

function currentPlatformWorkflow(): PlatformWorkflow | undefined {
  // globalThis may not have the tailor property at runtime
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  return (globalThis as GlobalWithRegistry).tailor?.workflow;
}

function requirePlatformWorkflow(): PlatformWorkflow {
  const workflow = currentPlatformWorkflow();
  if (!workflow) {
    throw new Error(
      "tailor.workflow is not available. Run tests in the `tailor-runtime` Vitest environment and use mockWorkflow(), or use runWorkflowLocally() from @tailor-platform/sdk/vitest for local workflow execution.",
    );
  }
  return workflow;
}

// A valid placeholder UUID, so callers that validate the execution id behave the
// same locally as against the platform.
export const TRIGGER_DEFAULT = "00000000-0000-4000-8000-000000000000";

// `.trigger()` routes through the installed `tailor.workflow` shim. Local body
// execution is intentionally available only through `runWorkflowLocally()`.
export function dispatchTriggerJob(name: string, args?: unknown): unknown {
  return requirePlatformWorkflow().triggerJobFunction(name, args);
}

export function dispatchTriggerWorkflow(
  name: string,
  args?: unknown,
  options?: { invoker?: unknown },
): Promise<string> {
  const workflow = requirePlatformWorkflow();
  if (options?.invoker === undefined) {
    return workflow.triggerWorkflow(name, args);
  }
  return workflow.triggerWorkflow(name, args, { authInvoker: options.invoker });
}
