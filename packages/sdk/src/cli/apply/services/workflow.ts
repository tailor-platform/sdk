import * as fs from "node:fs";
import * as path from "node:path";
import { getDistDir } from "@/configure/config";
import { type ApplyPhase } from "..";
import { type OperatorClient, fetchAll } from "../../client";
import { ChangeSet } from ".";
import type { Workflow, WorkflowJob } from "@/parser/service/workflow";

export async function applyWorkflow(
  client: OperatorClient,
  changeSet: Awaited<ReturnType<typeof planWorkflow>>,
  phase: ApplyPhase = "create-update",
) {
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
};

type UpdateWorkflow = {
  name: string;
  workspaceId: string;
  workflow: Workflow;
  scripts: Map<string, string>;
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

export async function planWorkflow(
  client: OperatorClient,
  workspaceId: string,
  workflows: Record<string, Workflow>,
) {
  const changeSet: ChangeSet<CreateWorkflow, UpdateWorkflow, DeleteWorkflow> =
    new ChangeSet("Workflows");

  // Fetch existing workflows from API
  const existingWorkflows = await fetchAll(async (pageToken) => {
    const response = await client.listWorkflows({
      workspaceId,
      pageToken,
      pageSize: 100,
      pageDirection: 0, // FORWARD
    });
    return [
      response.workflows.map((w) => ({ id: w.id, name: w.name })),
      response.nextPageToken,
    ];
  });

  const existingWorkflowMap = new Map<string, { id: string; name: string }>();
  existingWorkflows.forEach((workflow) => {
    existingWorkflowMap.set(workflow.name, {
      id: workflow.id,
      name: workflow.name,
    });
  });

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

    const existing = existingWorkflowMap.get(workflow.name);
    if (existing) {
      changeSet.updates.push({
        name: workflow.name,
        workspaceId,
        workflow,
        scripts,
      });
      existingWorkflowMap.delete(workflow.name);
    } else {
      changeSet.creates.push({
        name: workflow.name,
        workspaceId,
        workflow,
        scripts,
      });
    }
  }

  existingWorkflowMap.forEach((existing) => {
    changeSet.deletes.push({
      name: existing.name,
      workspaceId,
      workflowId: existing.id,
    });
  });

  changeSet.print();
  return changeSet;
}

async function loadWorkflowScripts(): Promise<Map<string, string>> {
  const scripts = new Map<string, string>();

  // Load all job scripts from workflow-jobs directory
  const jobsDir = path.join(getDistDir(), "workflow-jobs");
  if (!fs.existsSync(jobsDir)) {
    console.warn(`Warning: workflow-jobs directory not found at ${jobsDir}`);
    return scripts;
  }

  const files = fs.readdirSync(jobsDir);
  for (const file of files) {
    // Only load final bundled .js files (not .base.js, .transformed.js, or .map files)
    if (
      file.endsWith(".js") &&
      !file.endsWith(".base.js") &&
      !file.endsWith(".transformed.js") &&
      !file.endsWith(".map")
    ) {
      const jobName = file.replace(/\.js$/, "");
      const scriptPath = path.join(jobsDir, file);
      const script = fs.readFileSync(scriptPath, "utf-8");
      scripts.set(jobName, script);
    }
  }

  return scripts;
}
