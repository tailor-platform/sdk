/**
 * Function type detection for test-run command
 *
 * Detects the function type (resolver, executor, workflow job, or plain function)
 * by dynamically importing the module and checking against known schemas.
 */

import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { ExecutorSchema } from "@/parser/service/executor";
import { ResolverSchema } from "@/parser/service/resolver";
import { WorkflowJobSchema } from "@/parser/service/workflow";

export type FunctionType = "resolver" | "executor" | "workflow-job" | "plain";

export interface DetectedFunction {
  /** Detected function type */
  type: FunctionType;
  /** Function name (resolver name, executor name, job name, or filename-derived) */
  name: string;
  /** For workflow jobs: the TypeScript export name needed for bundling */
  exportName?: string;
  /** For plain functions: whether main is a named export rather than default export */
  namedMain?: boolean;
  /** For resolvers: whether the resolver defines an input schema */
  hasInput?: boolean;
  /** For resolvers with input: raw input field definitions for local validation */
  rawInput?: Record<string, unknown>;
}

interface DetectFunctionOptions {
  /** Absolute path to the function file */
  filePath: string;
  /** Workflow job name to select (matches the `name` field of createWorkflowJob) */
  jobName?: string;
}

/**
 * Detect the function type from a file by importing it and checking against schemas.
 * @param options - Detection options
 * @returns Detected function information
 */
export async function detectFunctionType(
  options: DetectFunctionOptions,
): Promise<DetectedFunction> {
  const { filePath, jobName } = options;

  const module = await import(pathToFileURL(filePath).href);

  // Priority: resolver → executor → workflow job → plain function

  // 1. Check resolver
  const resolverResult = ResolverSchema.safeParse(module.default);
  if (resolverResult.success) {
    return {
      type: "resolver",
      name: resolverResult.data.name,
      hasInput: module.default.input != null,
      rawInput: module.default.input,
    };
  }

  // 2. Check executor (only function/jobFunction kinds)
  const executorResult = ExecutorSchema.safeParse(module.default);
  if (executorResult.success) {
    const { operation } = executorResult.data;
    if (operation.kind === "function" || operation.kind === "jobFunction") {
      return { type: "executor", name: executorResult.data.name };
    }
  }

  // 3. Check workflow jobs (scan all named exports)
  const workflowJobResult = detectWorkflowJob(module, jobName);
  if (workflowJobResult) {
    return workflowJobResult;
  }

  // 4. Check plain function (default export or named export "main")
  if (typeof module.default === "function") {
    const name = deriveNameFromPath(filePath);
    return { type: "plain", name };
  }

  if (typeof module.main === "function") {
    const name = deriveNameFromPath(filePath);
    return { type: "plain", name, namedMain: true };
  }

  throw new Error(
    `Could not detect function type from ${filePath}.\n` +
      "The file must have one of:\n" +
      "  - A default-exported resolver (createResolver)\n" +
      "  - A default-exported executor (createExecutor) with function/jobFunction operation\n" +
      "  - A named-exported workflow job (createWorkflowJob)\n" +
      "  - A default-exported function\n" +
      '  - A named-exported "main" function',
  );
}

/**
 * Scan all named exports for workflow jobs.
 * If jobName is specified, find the job whose `.name` matches.
 * If not specified and exactly one job exists, use it.
 * If multiple jobs exist, throw an error with the list.
 * @param module - The imported module
 * @param jobName - Workflow job name to select
 * @returns Detected function or null if no workflow jobs found
 */
function detectWorkflowJob(
  module: Record<string, unknown>,
  jobName?: string,
): DetectedFunction | null {
  const jobs: Array<{ name: string; exportName: string }> = [];

  for (const [exportName, exportValue] of Object.entries(module)) {
    if (exportName === "default") continue;
    const result = WorkflowJobSchema.safeParse(exportValue);
    if (result.success) {
      jobs.push({ name: result.data.name, exportName });
    }
  }

  if (jobs.length === 0) {
    return null;
  }

  if (jobName) {
    const match = jobs.find((j) => j.name === jobName);
    if (!match) {
      const available = jobs.map((j) => `  - "${j.name}" (export: ${j.exportName})`).join("\n");
      throw new Error(`Workflow job "${jobName}" not found. Available jobs:\n${available}`);
    }
    return { type: "workflow-job", name: match.name, exportName: match.exportName };
  }

  if (jobs.length === 1) {
    return { type: "workflow-job", name: jobs[0].name, exportName: jobs[0].exportName };
  }

  const available = jobs.map((j) => `  - "${j.name}" (export: ${j.exportName})`).join("\n");
  throw new Error(`Multiple workflow jobs found. Specify one with --name:\n${available}`);
}

/**
 * Derive a script name from a file path (filename without extension).
 * @param filePath - Absolute path to the function file
 * @returns Filename without extension
 */
function deriveNameFromPath(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}
