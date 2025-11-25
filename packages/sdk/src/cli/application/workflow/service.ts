import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { styleText } from "node:util";
import { loadFilesWithIgnores } from "@/cli/application/file-loader";
import { type Workflow, WorkflowSchema } from "@/parser/service/workflow";
import type { WorkflowServiceConfig } from "@/configure/services/workflow/types";

export class WorkflowService {
  private workflows: Record<string, Workflow> = {};

  constructor(public readonly config: WorkflowServiceConfig) {}

  async loadWorkflows() {
    if (!this.config.files || this.config.files.length === 0) {
      return;
    }

    const workflowFiles = loadFilesWithIgnores(this.config);

    console.log("");
    console.log(
      "Found",
      styleText("cyanBright", workflowFiles.length.toString()),
      "workflow files",
    );

    for (const workflowFile of workflowFiles) {
      await this.loadWorkflowForFile(workflowFile);
    }
    return this.workflows;
  }

  async loadWorkflowForFile(workflowFile: string, timestamp?: Date) {
    try {
      const baseUrl = pathToFileURL(workflowFile).href;
      const moduleSpecifier =
        timestamp === undefined
          ? baseUrl
          : `${baseUrl}?t=${timestamp.getTime()}`;

      const workflowModule = await import(moduleSpecifier);
      const result = WorkflowSchema.safeParse(workflowModule.default);
      if (result.success) {
        const relativePath = path.relative(process.cwd(), workflowFile);
        console.log(
          "Workflow:",
          styleText("greenBright", `"${result.data.name}"`),
          "loaded from",
          styleText("cyan", relativePath),
        );
        this.workflows[workflowFile] = result.data;
      }
    } catch (error) {
      const relativePath = path.relative(process.cwd(), workflowFile);
      console.error(
        styleText("red", "Failed to load workflow from"),
        styleText("redBright", relativePath),
      );
      console.error(error);
      throw error;
    }
    return this.workflows[workflowFile];
  }

  getWorkflows() {
    return this.workflows;
  }
}
