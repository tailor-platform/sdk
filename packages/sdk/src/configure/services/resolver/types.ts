export type ResolverServiceConfig = { files: string[]; ignores?: string[] };

export type ResolverExternalConfig = { external: true };

export type ResolverServiceInput = {
  [namespace: string]: ResolverServiceConfig | ResolverExternalConfig;
};
