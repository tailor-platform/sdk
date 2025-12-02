import * as fs from "node:fs";
import * as path from "node:path";
import { getDistDir } from "@/configure/config";
import { type ApplyPhase } from "..";
import { type OperatorClient, fetchAll } from "../../client";
import { buildMetaRequest, sdkNameLabelKey, type WithLabel } from "./label";
import { ChangeSet } from ".";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { Workflow, WorkflowJob } from "@/parser/service/workflow";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

export async function applyWorkflow(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planWorkflow>>,
  phase: ApplyPhase = "create-update",
) {
  const { changeSet } = result;
  if (phase === "create-update") {
    // Create workflows and their job functions
    await Promise.all(
      changeSet.creates.map(async (create) => {
        // Create job functions first
        const jobFunctions: { [key: string]: bigint } = {};
        for (const [jobName, script] of create.scripts.entries()) {
          const response = await client.createWorkflowJobFunction({
            workspaceId: create.workspaceId,
            jobFunctionName: jobName,
            script: script,
          });
          if (response.jobFunction) {
            jobFunctions[jobName] = response.jobFunction.version;
          }
        }

        // Create workflow with job function versions
        await client.createWorkflow({
          workspaceId: create.workspaceId,
          workflowName: create.workflow.name,
          mainJobFunctionName: create.workflow.mainJob.name,
          jobFunctions: jobFunctions,
        });
        await client.setMetadata(create.metaRequest);
      }),
    );

    // Update workflows and their job functions
    await Promise.all(
      changeSet.updates.map(async (update) => {
        // Update or create job functions
        const jobFunctions: { [key: string]: bigint } = {};
        for (const [jobName, script] of update.scripts.entries()) {
          const response = await client.updateWorkflowJobFunction({
            workspaceId: update.workspaceId,
            jobFunctionName: jobName,
            script: script,
          });
          if (response.jobFunction) {
            jobFunctions[jobName] = response.jobFunction.version;
          }
        }

        // Update workflow with job function versions
        await client.updateWorkflow({
          workspaceId: update.workspaceId,
          workflowName: update.workflow.name,
          mainJobFunctionName: update.workflow.mainJob.name,
          jobFunctions: jobFunctions,
        });
        await client.setMetadata(update.metaRequest);
      }),
    );
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

type CreateWorkflow = {
  name: string;
  workspaceId: string;
  workflow: Workflow;
  scripts: Map<string, string>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type UpdateWorkflow = {
  name: string;
  workspaceId: string;
  workflow: Workflow;
  scripts: Map<string, string>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type DeleteWorkflow = {
  name: string;
  workspaceId: string;
  workflowId: string;
};

/**
 * Recursively collect all job names from a workflow's mainJob and its dependencies
 */
export function collectJobNamesFromWorkflow(workflow: Workflow): Set<string> {
  const jobNames = new Set<string>();

  const collectFromJob = (job: WorkflowJob) => {
    if (!job || jobNames.has(job.name)) {
      return;
    }
    jobNames.add(job.name);

    if (job.deps && Array.isArray(job.deps)) {
      for (const dep of job.deps) {
        collectFromJob(dep);
      }
    }
  };

  collectFromJob(workflow.mainJob);
  return jobNames;
}

function trn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:workflow:${name}`;
}

export async function planWorkflow(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
  workflows: Record<string, Workflow>,
) {
  const changeSet: ChangeSet<CreateWorkflow, UpdateWorkflow, DeleteWorkflow> =
    new ChangeSet("Workflows");
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  // Fetch existing workflows from API
  const withoutLabel = await fetchAll(async (pageToken) => {
    const response = await client.listWorkflows({
      workspaceId,
      pageToken,
    });
    return [
      response.workflows.map((w) => ({ id: w.id, name: w.name })),
      response.nextPageToken,
    ];
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

  // Load all available scripts once
  const allScripts = await loadWorkflowScripts();

  for (const workflow of Object.values(workflows)) {
    // Get only the jobs needed for this specific workflow
    const requiredJobNames = collectJobNamesFromWorkflow(workflow);
    const scripts = new Map<string, string>();

    for (const jobName of requiredJobNames) {
      const script = allScripts.get(jobName);
      if (script) {
        scripts.set(jobName, script);
      } else {
        console.warn(
          `Warning: Script for job "${jobName}" not found in workflow "${workflow.name}"`,
        );
      }
    }

    const existing = existingWorkflows[workflow.name];
    const metaRequest = await buildMetaRequest(
      trn(workspaceId, workflow.name),
      appName,
    );
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
        scripts,
        metaRequest,
      });
      delete existingWorkflows[workflow.name];
    } else {
      changeSet.creates.push({
        name: workflow.name,
        workspaceId,
        workflow,
        scripts,
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
    // Only load final bundled .js files (e.g., "jobname.js", not "jobname.base.js")
    if (/^[^.]+\.js$/.test(file)) {
      const jobName = file.replace(/\.js$/, "");
      const scriptPath = path.join(jobsDir, file);
      const script = fs.readFileSync(scriptPath, "utf-8");
      scripts.set(jobName, script);
    }
  }

  return scripts;
}
