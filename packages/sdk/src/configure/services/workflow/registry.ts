import type { TailorEnv } from "@/types/env";
import type { TailorInvoker } from "@/types/user";

/**
 * Body signature shared by workflow jobs at registry-write time.
 * The user's `createWorkflowJob`/`createWorkflow` body uses concrete types,
 * but the registry erases them for storage.
 */
export type RegisteredJobBody = (
  args: unknown,
  context: { env: TailorEnv; invoker: TailorInvoker | null },
) => unknown | Promise<unknown>;

export interface RegisteredWorkflow {
  mainJobName: string;
}

const JOB_REGISTRY_KEY: unique symbol = Symbol.for("tailor-platform/sdk:job-registry");
const WORKFLOW_REGISTRY_KEY: unique symbol = Symbol.for("tailor-platform/sdk:workflow-registry");

type PlatformWorkflow = {
  triggerWorkflow: (name: string, args?: unknown, options?: unknown) => Promise<string>;
  triggerJobFunction: (name: string, args?: unknown) => unknown;
};

type GlobalWithRegistry = typeof globalThis & {
  [JOB_REGISTRY_KEY]?: Map<string, RegisteredJobBody>;
  [WORKFLOW_REGISTRY_KEY]?: Map<string, RegisteredWorkflow>;
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

function workflows(): Map<string, RegisteredWorkflow> {
  const g = globalThis as GlobalWithRegistry;
  let map = g[WORKFLOW_REGISTRY_KEY];
  if (!map) {
    map = new Map();
    g[WORKFLOW_REGISTRY_KEY] = map;
  }
  return map;
}

/**
 * Register a job body keyed by job name. Called as a side effect by
 * `createWorkflowJob` so the vitest mock can execute the body when
 * `globalThis.tailor.workflow.triggerJobFunction(name, args)` is invoked.
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

/**
 * Register a workflow's main job name so the mock can run the workflow locally.
 * @param name - Workflow name
 * @param mainJobName - Name of the workflow's main job
 */
export function registerWorkflow(name: string, mainJobName: string): void {
  workflows().set(name, { mainJobName });
}

/**
 * Look up a registered workflow by name.
 * @param name - Workflow name
 * @returns The registered workflow, or undefined
 */
export function getRegisteredWorkflow(name: string): RegisteredWorkflow | undefined {
  return workflows().get(name);
}

/**
 * Return the injected `globalThis.tailor.workflow` shim used by `.trigger()`.
 * Production installs it natively; tests install it via `mockWorkflow()` (or the
 * `tailor-runtime` environment). Throws when neither is present.
 * @returns The platform-injected workflow shim
 */
export function getPlatformWorkflow(): PlatformWorkflow {
  const workflow = (globalThis as GlobalWithRegistry).tailor?.workflow;
  if (!workflow) {
    throw new Error(
      "tailor.workflow is not available. Acquire mockWorkflow() from @tailor-platform/sdk/vitest in tests.",
    );
  }
  return workflow;
}
