export type ResolverServiceConfig = { files: string[] };
export type ResolverServiceInput = {
  [namespace: string]: ResolverServiceConfig;
};
