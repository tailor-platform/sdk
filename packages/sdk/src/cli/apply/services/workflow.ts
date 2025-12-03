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
  phase: ApplyPhase = "create-update",
) {
  const { changeSet } = result;
  if (phase === "create-update") {
    // Register all job functions once (shared across all workflows)
    const jobFunctionVersions = await registerJobFunctions(client, changeSet);

    // Create and update workflows in parallel
    await Promise.all([
      ...changeSet.creates.map(async (create) => {
        await client.createWorkflow({
          workspaceId: create.workspaceId,
          workflowName: create.workflow.name,
          mainJobFunctionName: create.workflow.mainJob.name,
          jobFunctions: jobFunctionVersions,
        });
        await client.setMetadata(create.metaRequest);
      }),
      ...changeSet.updates.map(async (update) => {
        await client.updateWorkflow({
          workspaceId: update.workspaceId,
          workflowName: update.workflow.name,
          mainJobFunctionName: update.workflow.mainJob.name,
          jobFunctions: jobFunctionVersions,
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
 * Register all job functions once, returns a map of job name to version.
 * Uses update for existing workflows, create for new workflows.
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

  // Determine if we should use create or update based on whether any workflows exist
  const hasExistingWorkflows = changeSet.updates.length > 0;

  // Register all job functions in parallel
  const results = await Promise.all(
    Array.from(scripts.entries()).map(async ([jobName, script]) => {
      const response = hasExistingWorkflows
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
  // Dependencies are now detected at bundle time via AST, so we use all available scripts
  const allScripts = await loadWorkflowScripts();

  for (const workflow of Object.values(workflows)) {
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
        scripts: allScripts,
        metaRequest,
      });
      delete existingWorkflows[workflow.name];
    } else {
      changeSet.creates.push({
        name: workflow.name,
        workspaceId,
        workflow,
        scripts: allScripts,
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
