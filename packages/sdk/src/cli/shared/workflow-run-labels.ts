import * as crypto from "node:crypto";

/**
 * Labels that mark the temporary resources of `workflow run`
 *
 * The resources carry no owner label (`sdk-name` / `sdk-app-id`): a deploy
 * treats every remote-only resource owned by its application as an orphan and
 * removes it without looking at executions, which would pull a workflow out
 * from under a run that is still going.
 */

const workflowRunLabelKey = "sdk-workflow-run-job";

/** Base-36 digits of the start time in a run id */
const RUN_ID_SECONDS_LENGTH = 8;

export interface WorkflowRunMarker {
  runId: string;
}

/**
 * Create the id that ties one run to its temporary resources.
 * @param now - Start time of the run
 * @param random - Lowercase alphanumeric suffix that tells runs of the same second apart
 * @returns Id usable as a label value
 */
export function createRunId(now: Date, random: string): string {
  const seconds = Math.floor(now.getTime() / 1000)
    .toString(36)
    .padStart(RUN_ID_SECONDS_LENGTH, "0");
  return `r${seconds}-${random}`;
}

/**
 * Build the labels that mark a run's resources.
 * @param marker - Id of the run
 * @returns Labels to write
 */
export function workflowRunLabels(marker: WorkflowRunMarker): Record<string, string> {
  return { [workflowRunLabelKey]: marker.runId };
}

/**
 * Read which run a resource belongs to.
 * @param labels - Labels of the resource
 * @returns The run, or undefined for a resource that is not a `workflow run` one
 */
export function readWorkflowRunMarker(
  labels: Record<string, string> | undefined,
): WorkflowRunMarker | undefined {
  const runId = labels?.[workflowRunLabelKey];
  return runId ? { runId } : undefined;
}

const RESOURCE_PREFIX = "tmp-run-";

/** A whole run id: what {@link createRunId} builds, with a suffix free of hyphens */
const FUNCTION_RUN_ID = new RegExp(`^r[0-9a-z]{${RUN_ID_SECONDS_LENGTH}}-[0-9a-z]+$`);

/** Longest name the Platform accepts for a job function. */
const MAX_NAME_LENGTH = 63;
const SUFFIX_LENGTH = 8;

/**
 * Name of the workflow of one run.
 * @param runId - Id of the run
 * @returns Resource name
 */
export function workflowRunResourceName(runId: string): string {
  return `${RESOURCE_PREFIX}${runId}`;
}

/**
 * Name of the job function and function a run registers for one workflow job.
 * Job function names are shared by the whole workspace, so the name of the job
 * alone would collide with the deployed job of the same name. A name that would
 * pass the length the Platform accepts is cut short and ends with a hash of the
 * job name, so that two long names stay apart.
 * @param runId - Id of the run
 * @param jobName - Name of the workflow job
 * @returns Resource name
 */
export function workflowRunJobFunctionName(runId: string, jobName: string): string {
  const full = `${workflowRunResourceName(runId)}-${jobName}`;
  if (full.length <= MAX_NAME_LENGTH) return full;
  const suffix = crypto.createHash("sha256").update(jobName).digest("hex").slice(0, SUFFIX_LENGTH);
  return `${full.slice(0, MAX_NAME_LENGTH - SUFFIX_LENGTH - 1).replace(/-+$/, "")}-${suffix}`;
}

/**
 * Whether a resource name is in the namespace `workflow run` creates its resources in.
 * @param name - Resource name
 * @returns True for a name that starts with the prefix of the temporary resources
 */
export function isWorkflowRunResourceName(name: string): boolean {
  return name.startsWith(RESOURCE_PREFIX);
}

/**
 * Tell whether a name is the function `function run --async` registers, as opposed to the
 * function of a workflow job a run registers (`<name>-<job>`) or a deployed job.
 * @param name - Resource or script name
 * @returns True for exactly the name of a run's own function
 */
export function isFunctionRunResourceName(name: string): boolean {
  return (
    name.startsWith(RESOURCE_PREFIX) && FUNCTION_RUN_ID.test(name.slice(RESOURCE_PREFIX.length))
  );
}

/**
 * Read the start time out of a run id.
 * @param runId - Id created by {@link createRunId}
 * @returns Start time truncated to the second, or undefined for any other id
 */
export function runIdStartedAt(runId: string): Date | undefined {
  const match = new RegExp(`^r([0-9a-z]{${RUN_ID_SECONDS_LENGTH}})-`).exec(runId);
  if (!match?.[1]) return undefined;
  return new Date(Number.parseInt(match[1], 36) * 1000);
}
