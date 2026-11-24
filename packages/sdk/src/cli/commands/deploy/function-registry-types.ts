export type FunctionEntry = {
  name: string;
  scriptContent: string;
  contentHash: string;
  description: string;
  /** Resolver namespace of a resolver's function. */
  pipelineNamespace?: string;
};

/**
 * In-memory bundled scripts organized by kind.
 */
export type BundledScripts = {
  resolvers: Map<string, string>;
  executors: Map<string, string>;
  workflowJobs: Map<string, string>;
  authHooks: Map<string, string>;
};
