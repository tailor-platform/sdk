import type {
  DeployedApplication,
  DeployedStaticWebsite,
  PluginExecOptions,
  PluginExecResult,
  PluginLogger,
  StaticWebsiteConfig,
} from "@tailor-platform/sdk";

export interface FrontendDefinition {
  /** Static website included in this deploy. Accepts a name or a defineStaticWebSite result. */
  site: string | StaticWebsiteConfig;
  /** Directory to run `build` in, relative to the registering config's directory. Defaults to that directory. */
  workingDir?: string;
  /**
   * Shell command, or async function, that builds assets. Omit to upload existing assets.
   * A function runs after `env` resolves and before the upload, and fails the deploy when it rejects.
   */
  build?: string | ((context: FrontendBuildContext) => void | Promise<void>);
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

/** Options for {@link FrontendBuildContext.exec}. Omitted fields take the values the build runs with. */
export type FrontendExecOptions = Partial<PluginExecOptions>;

/** Passed to a function `build`. */
export interface FrontendBuildContext extends FrontendEnvContext {
  /** Values the `env` callback returned. Empty when the frontend has no `env`. */
  env: Record<string, string>;
  /** Absolute directory commands run in by default. */
  workingDir: string;
  /** Absolute directory whose contents are published after the function returns. */
  distDir: string;
  logger: PluginLogger;
  /**
   * Run a shell command in `workingDir` with `env` added to the environment.
   * Rejects when the command exits with a non-zero code.
   * @param command - Shell command, such as `pnpm build`
   * @param options - Overrides for the working directory, the environment values added on top of `env`, and output handling
   * @returns Captured output when `options.output` is `"capture"`
   */
  exec: (command: string, options?: FrontendExecOptions) => Promise<PluginExecResult>;
}
