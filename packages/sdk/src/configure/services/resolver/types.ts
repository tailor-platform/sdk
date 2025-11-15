export type ResolverServiceConfig = { files: string[]; ignores?: string[] };
export type ResolverServiceInput = {
  [namespace: string]: ResolverServiceConfig;
};
