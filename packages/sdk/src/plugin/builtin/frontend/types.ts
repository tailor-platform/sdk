import type { StaticWebsiteConfig } from "#/configure/services/staticwebsite/types";
import type { DeployedApplication, DeployedStaticWebsite } from "#/plugin/types";

export interface FrontendDefinition {
  /** Static website included in this deploy. Accepts a name or a defineStaticWebSite result. */
  site: string | StaticWebsiteConfig;
  /** Directory to run `build` in, relative to the registering config's directory. Defaults to that directory. */
  workingDir?: string;
  /** Shell command to build assets. Omit to upload existing assets. */
  build?: string;
  /** Directory the build writes its assets to, relative to workingDir or absolute. Its contents are published. */
  distDir: string;
  /** Environment variables added to the build process. Values may be resolved asynchronously. */
  env?: (context: FrontendEnvContext) => Record<string, string> | Promise<Record<string, string>>;
}

export interface FrontendEnvContext {
  /** Upload destination for this frontend. */
  site: DeployedStaticWebsite;
  application: DeployedApplication;
  applications: readonly DeployedApplication[];
  staticWebsites: Readonly<Partial<Record<string, DeployedStaticWebsite>>>;
  workspaceId: string;
}
