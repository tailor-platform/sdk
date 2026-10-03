import type {
  DeployedApplication,
  DeployedStaticWebsite,
  StaticWebsiteConfig,
} from "@tailor-platform/sdk";

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
  /** Application whose config registers this frontend. */
  application: DeployedApplication;
  /** Every application in this deploy run. Read other configs' site URLs from their `staticWebsites`. */
  applications: readonly DeployedApplication[];
  workspaceId: string;
}
