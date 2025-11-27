export type WorkflowServiceConfig = {
  files: string[];
  job_files?: string[];
  ignores?: string[];
  job_ignores?: string[];
};

export type WorkflowServiceInput = WorkflowServiceConfig;
