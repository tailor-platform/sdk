/**
 * Labels that mark the temporary resources of `workflow run`
 *
 * The resources carry no owner label (`sdk-name` / `sdk-app-id`): a deploy
 * treats every remote-only resource owned by its application as an orphan and
 * removes it without looking at executions, which would pull a workflow out
 * from under a run that is still going.
 */

const workflowRunLabelKey = "sdk-workflow-run";
const workflowRunJobLabelKey = "sdk-workflow-run-job";

export type WorkflowRunKind = "script" | "job";

export interface WorkflowRunMarker {
  kind: WorkflowRunKind;
  runId: string;
}

const KEY_BY_KIND: Record<WorkflowRunKind, string> = {
  script: workflowRunLabelKey,
  job: workflowRunJobLabelKey,
};

/**
 * Create the id that ties one run to its temporary resources.
 * @param now - Start time of the run
 * @param random - Lowercase alphanumeric suffix that tells runs of the same second apart
 * @returns Id usable as a label value
 */
export function createRunId(now: Date, random: string): string {
  const seconds = Math.floor(now.getTime() / 1000)
    .toString(36)
    .padStart(8, "0");
  return `r${seconds}-${random}`;
}

/**
 * Build the labels that mark a run's resources.
 * @param marker - Kind and id of the run
 * @returns Labels to write
 */
export function workflowRunLabels(marker: WorkflowRunMarker): Record<string, string> {
  return { [KEY_BY_KIND[marker.kind]]: marker.runId };
}

/**
 * Read which run a resource belongs to. Keys are compared whole because the
 * job key begins with the run key.
 * @param labels - Labels of the resource
 * @returns The run, or undefined for a resource that is not a `workflow run` one
 */
export function readWorkflowRunMarker(
  labels: Record<string, string> | undefined,
): WorkflowRunMarker | undefined {
  if (!labels) return undefined;
  for (const kind of ["script", "job"] as const) {
    const runId = labels[KEY_BY_KIND[kind]];
    if (runId) return { kind, runId };
  }
  return undefined;
}

const RESOURCE_PREFIX = "tmp-run-";

/**
 * Name of the workflow of one run, and of the function and job function of a
 * whole-file run.
 * @param runId - Id of the run
 * @returns Resource name
 */
export function workflowRunResourceName(runId: string): string {
  return `${RESOURCE_PREFIX}${runId}`;
}

/**
 * Name of the job function and function a run registers for one workflow job.
 * Job function names are shared by the whole workspace, so the name of the job
 * alone would collide with the deployed job of the same name.
 * @param runId - Id of the run
 * @param jobName - Name of the workflow job
 * @returns Resource name
 */
export function workflowRunJobFunctionName(runId: string, jobName: string): string {
  return `${workflowRunResourceName(runId)}-${jobName}`;
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
 * Read the start time out of a run id.
 * @param runId - Id created by {@link createRunId}
 * @returns Start time truncated to the second, or undefined for any other id
 */
export function runIdStartedAt(runId: string): Date | undefined {
  const match = /^r([0-9a-z]{8})-/.exec(runId);
  if (!match?.[1]) return undefined;
  return new Date(Number.parseInt(match[1], 36) * 1000);
}
