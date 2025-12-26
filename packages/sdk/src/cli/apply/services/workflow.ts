import * as fs from "node:fs";
import * as path from "node:path";
import { getDistDir } from "@/configure/config";
import { type ApplyPhase } from "..";
import { type OperatorClient, fetchAll } from "../../client";
import { buildMetaRequest, sdkNameLabelKey, type WithLabel } from "./label";
import { ChangeSet } from ".";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { Workflow } from "@/parser/service/workflow";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

export async function applyWorkflow(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planWorkflow>>,
  phase: Extract<ApplyPhase, "create-update" | "delete"> = "create-update",
) {
  const { changeSet } = result;
  if (phase === "create-update") {
    // Register job functions used by any workflow, returns map of job name to version
    const jobFunctionVersions = await registerJobFunctions(client, changeSet);

    // Create and update workflows in parallel
    // Each workflow only gets the job function versions it actually uses
    await Promise.all([
      ...changeSet.creates.map(async (create) => {
        const filteredVersions = filterJobFunctionVersions(
          jobFunctionVersions,
          create.usedJobNames,
        );
        await client.createWorkflow({
          workspaceId: create.workspaceId,
          workflowName: create.workflow.name,
          mainJobFunctionName: create.workflow.mainJob.name,
          jobFunctions: filteredVersions,
        });
        await client.setMetadata(create.metaRequest);
      }),
      ...changeSet.updates.map(async (update) => {
        const filteredVersions = filterJobFunctionVersions(
          jobFunctionVersions,
          update.usedJobNames,
        );
        await client.updateWorkflow({
          workspaceId: update.workspaceId,
          workflowName: update.workflow.name,
          mainJobFunctionName: update.workflow.mainJob.name,
          jobFunctions: filteredVersions,
        });
        await client.setMetadata(update.metaRequest);
      }),
    ]);
  } else if (phase === "delete") {
    // Delete workflows
    await Promise.all(
      changeSet.deletes.map((del) =>
        client.deleteWorkflow({
          workspaceId: del.workspaceId,
          workflowId: del.workflowId,
        }),
      ),
    );
  }
}

/**
 * Filter job function versions to only include those used by a workflow
 */
function filterJobFunctionVersions(
  allVersions: { [key: string]: bigint },
  usedJobNames: string[],
): { [key: string]: bigint } {
  const filtered: { [key: string]: bigint } = {};
  for (const jobName of usedJobNames) {
    if (allVersions[jobName] !== undefined) {
      filtered[jobName] = allVersions[jobName];
    }
  }
  return filtered;
}

/**
 * Register job functions used by any workflow.
 * Only registers jobs that are actually used (based on usedJobNames in changeSet).
 * Uses create for new jobs and update for existing jobs.
 */
async function registerJobFunctions(
  client: OperatorClient,
  changeSet: ChangeSet<CreateWorkflow, UpdateWorkflow, DeleteWorkflow>,
): Promise<{ [key: string]: bigint }> {
  const jobFunctionVersions: { [key: string]: bigint } = {};

  // Get scripts from the first workflow (all workflows share the same scripts)
  const firstWorkflow = changeSet.creates[0] || changeSet.updates[0];
  if (!firstWorkflow) {
    return jobFunctionVersions;
  }

  const { workspaceId, scripts } = firstWorkflow;

  // Collect all job names used by any workflow
  const allUsedJobNames = new Set<string>();
  for (const item of [...changeSet.creates, ...changeSet.updates]) {
    for (const jobName of item.usedJobNames) {
      allUsedJobNames.add(jobName);
    }
  }

  // Fetch existing job function names
  const existingJobNames = await fetchAll(async (pageToken) => {
    const response = await client.listWorkflowJobFunctions({
      workspaceId,
      pageToken,
    });
    return [response.jobFunctions.map((j) => j.name), response.nextPageToken];
  });
  const existingJobNamesSet = new Set(existingJobNames);

  // Register job functions in parallel
  // Use create for new jobs, update for existing jobs
  const results = await Promise.all(
    Array.from(allUsedJobNames).map(async (jobName) => {
      const script = scripts.get(jobName);
      if (!script) {
        throw new Error(
          `No bundled script found for job "${jobName}". ` +
            `Please run "generate" command before "apply".`,
        );
      }

      const isExisting = existingJobNamesSet.has(jobName);
      const response = isExisting
        ? await client.updateWorkflowJobFunction({
            workspaceId,
            jobFunctionName: jobName,
            script,
          })
        : await client.createWorkflowJobFunction({
            workspaceId,
            jobFunctionName: jobName,
            script,
          });
      return { jobName, version: response.jobFunction?.version };
    }),
  );

  for (const { jobName, version } of results) {
    if (version) {
      jobFunctionVersions[jobName] = version;
    }
  }

  return jobFunctionVersions;
}

type CreateWorkflow = {
  name: string;
  workspaceId: string;
  workflow: Workflow;
  scripts: Map<string, string>;
  usedJobNames: string[];
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type UpdateWorkflow = {
  name: string;
  workspaceId: string;
  workflow: Workflow;
  scripts: Map<string, string>;
  usedJobNames: string[];
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type DeleteWorkflow = {
  name: string;
  workspaceId: string;
  workflowId: string;
};

function trn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:workflow:${name}`;
}

export async function planWorkflow(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
  workflows: Record<string, Workflow>,
  mainJobDeps: Record<string, string[]>,
) {
  const changeSet: ChangeSet<CreateWorkflow, UpdateWorkflow, DeleteWorkflow> = new ChangeSet(
    "Workflows",
  );
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  // Fetch existing workflows from API
  const withoutLabel = await fetchAll(async (pageToken) => {
    const response = await client.listWorkflows({
      workspaceId,
      pageToken,
    });
    return [response.workflows.map((w) => ({ id: w.id, name: w.name })), response.nextPageToken];
  });
  const existingWorkflows: WithLabel<(typeof withoutLabel)[number]> = {};
  await Promise.all(
    withoutLabel.map(async (resource) => {
      const { metadata } = await client.getMetadata({
        trn: trn(workspaceId, resource.name),
      });
      existingWorkflows[resource.name] = {
        resource,
        label: metadata?.labels[sdkNameLabelKey],
      };
    }),
  );

  // Load all available scripts
  const allScripts = await loadWorkflowScripts();

  for (const workflow of Object.values(workflows)) {
    const existing = existingWorkflows[workflow.name];
    const metaRequest = await buildMetaRequest(trn(workspaceId, workflow.name), appName);
    // Get jobs used by this workflow from mainJobDeps
    const usedJobNames = mainJobDeps[workflow.mainJob.name];
    if (!usedJobNames) {
      throw new Error(
        `No dependency info found for mainJob "${workflow.mainJob.name}". ` +
          `Please run "generate" command before "apply".`,
      );
    }

    if (existing) {
      if (!existing.label) {
        unmanaged.push({
          resourceType: "Workflow",
          resourceName: workflow.name,
        });
      } else if (existing.label !== appName) {
        conflicts.push({
          resourceType: "Workflow",
          resourceName: workflow.name,
          currentOwner: existing.label,
        });
      }

      changeSet.updates.push({
        name: workflow.name,
        workspaceId,
        workflow,
        scripts: allScripts,
        usedJobNames,
        metaRequest,
      });
      delete existingWorkflows[workflow.name];
    } else {
      changeSet.creates.push({
        name: workflow.name,
        workspaceId,
        workflow,
        scripts: allScripts,
        usedJobNames,
        metaRequest,
      });
    }
  }

  Object.values(existingWorkflows).forEach((existing) => {
    const label = existing?.label;
    if (label && label !== appName) {
      resourceOwners.add(label);
    }
    // Only delete workflows managed by this application
    if (label === appName) {
      changeSet.deletes.push({
        name: existing!.resource.name,
        workspaceId,
        workflowId: existing!.resource.id,
      });
    }
  });

  changeSet.print();
  return { changeSet, conflicts, unmanaged, resourceOwners };
}

async function loadWorkflowScripts(): Promise<Map<string, string>> {
  const scripts = new Map<string, string>();

  // Load all job scripts from workflow-jobs directory
  const jobsDir = path.join(getDistDir(), "workflow-jobs");
  if (!fs.existsSync(jobsDir)) {
    return scripts;
  }

  const files = fs.readdirSync(jobsDir);
  for (const file of files) {
    // Only load final bundled .js files (e.g., "job-name.js", not "job-name.base.js")
    if (/^[^.]+\.js$/.test(file)) {
      const jobName = file.replace(/\.js$/, "");
      const scriptPath = path.join(jobsDir, file);
      const script = fs.readFileSync(scriptPath, "utf-8");
      scripts.set(jobName, script);
    }
  }

  return scripts;
}
