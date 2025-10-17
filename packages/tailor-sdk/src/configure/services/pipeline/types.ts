export type PipelineResolverServiceConfig = { files: string[] };
export type PipelineResolverServiceInput = {
  [namespace: string]: PipelineResolverServiceConfig;
};
