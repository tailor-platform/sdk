import { platformSerialize } from "@/utils/test/platform-serialize";
import { buildJobContext } from "./test-env-key";
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

function currentPlatformWorkflow(): PlatformWorkflow | undefined {
  // globalThis may not have the tailor property at runtime
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  return (globalThis as GlobalWithRegistry).tailor?.workflow;
}

// A valid placeholder UUID, so callers that validate the execution id behave the
// same locally as against the platform.
export const TRIGGER_DEFAULT = "00000000-0000-4000-8000-000000000000";

function serializeReturn(out: unknown): unknown {
  return out instanceof Promise ? out.then((v) => platformSerialize(v)) : platformSerialize(out);
}

// Runs the registered body across the platform JSON boundary. Shared by the
// `tailor-runtime` default runner and the no-shim `.trigger()` fallback below.
export function runRegisteredJob(name: string, args?: unknown): unknown {
  const body = getRegisteredJob(name);
  const out = body ? body(platformSerialize(args), buildJobContext()) : null;
  return serializeReturn(out);
}

export async function runRegisteredWorkflow(name: string, args?: unknown): Promise<string> {
  const workflow = getRegisteredWorkflow(name);
  if (workflow) await runRegisteredJob(workflow.mainJobName, args);
  return TRIGGER_DEFAULT;
}

// `.trigger()` routes through the installed `tailor.workflow` shim, falling back
// to running the registered body/workflow locally when none is installed.
export function dispatchTriggerJob(name: string, args?: unknown): unknown {
  const workflow = currentPlatformWorkflow();
  return workflow ? workflow.triggerJobFunction(name, args) : runRegisteredJob(name, args);
}

export function dispatchTriggerWorkflow(
  name: string,
  args?: unknown,
  options?: unknown,
): Promise<string> {
  const workflow = currentPlatformWorkflow();
  return workflow
    ? workflow.triggerWorkflow(name, args, options)
    : runRegisteredWorkflow(name, args);
}
