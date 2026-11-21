import { getApplicationAuthNamespace } from "#/cli/shared/auth-namespace";
import { internalError } from "#/cli/shared/errors";
import type { Application, ConfigServices } from "#/cli/services/application";
import type { ApplicationSettings } from "#/configure/config/types";
import type { WorkspaceApplication } from "#/parser/app-config/types";

/** An application a deploy plans, with the services its GraphQL API exposes. */
export type DeployApplication = {
  readonly name: string;
  readonly subgraphs: ReadonlyArray<{ Type: string; Name: string }>;
  /** Auth namespace of the application, defined by the config or outside it. */
  readonly authNamespace: string | undefined;
  readonly settings: Readonly<ApplicationSettings>;
};

/**
 * Describe the application of a `defineConfig()` config as a deploy plans it.
 * @param application - Loaded application
 * @returns The application to plan
 */
export function deployApplicationOf(application: Readonly<Application>): DeployApplication {
  const { cors, allowedIpAddresses, disableIntrospection, metadata } = application.config;
  return {
    name: application.name,
    subgraphs: application.subgraphs,
    authNamespace: getApplicationAuthNamespace(application),
    settings: { cors, allowedIpAddresses, disableIntrospection, metadata },
  };
}

/**
 * Describe the applications of a workspace config as a deploy plans them.
 * @param apps - The workspace's `apps`, by application name
 * @returns The applications to plan, in config order
 */
export function workspaceDeployApplications(
  apps: Readonly<Record<string, WorkspaceApplication>>,
): DeployApplication[] {
  return Object.entries(apps).map(([name, app]) => {
    const { db, resolver, idp, auth, ...settings } = app;
    return {
      name,
      subgraphs: [
        ...db.map((namespace) => ({ Type: "tailordb", Name: namespace })),
        ...resolver.map((namespace) => ({ Type: "pipeline", Name: namespace })),
        ...(idp === undefined ? [] : [{ Type: "idp", Name: idp }]),
        ...(auth === undefined ? [] : [{ Type: "auth", Name: auth }]),
      ],
      authNamespace: auth,
      settings,
    };
  });
}

type AuthNamespaceContext = {
  application: Pick<ConfigServices, "authServices">;
  applications: ReadonlyArray<Pick<DeployApplication, "authNamespace">>;
};

/**
 * Get the Auth namespace that a config's executors, resolvers, and invokers use.
 * @param context - Services and applications of the config
 * @returns The Auth namespace, or undefined when the config uses none
 */
export function configAuthNamespace(context: AuthNamespaceContext): string | undefined {
  const names = new Set([
    ...context.application.authServices.map((service) => service.config.name),
    ...context.applications.flatMap((app) => (app.authNamespace ? [app.authNamespace] : [])),
  ]);
  const [name, ...others] = names;
  if (others.length > 0) {
    throw internalError(
      `A config uses one Auth namespace at most, but found ${[...names].join(", ")}`,
    );
  }
  return name;
}
