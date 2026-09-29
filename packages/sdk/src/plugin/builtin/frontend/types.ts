import type { DeployedApplication, DeployedStaticWebsite } from "#/plugin/types";

export interface FrontendDefinition {
  /** Static website included in this deploy. Accepts a name or a defineStaticWebSite result. */
  site: string | { readonly name: string };
  /** Working directory relative to the registering config's directory. Defaults to that directory. */
  cwd?: string;
  /** Shell command to build assets. Omit to upload existing assets. */
  build?: string;
  /** Output directory relative to cwd, or an absolute path. */
  outDir: string;
  /** Environment variables added to the build process. Values may be resolved asynchronously. */
  env?: (context: FrontendEnvContext) => Record<string, string> | Promise<Record<string, string>>;
}

export interface FrontendEnvContext {
  /** Upload destination for this frontend. */
  site: DeployedStaticWebsite;
  application: DeployedApplication;
  applications: readonly DeployedApplication[];
  staticWebsites: Readonly<Record<string, DeployedStaticWebsite>>;
  workspaceId: string;
}

export interface FrontendPluginOptions {
  /** Frontends to build and upload sequentially. Each site may appear only once. */
  frontends: FrontendDefinition[];
}
