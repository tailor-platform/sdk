import { getApplicationAuthNamespace } from "#/cli/shared/auth-namespace";
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

/** What it takes to tell which applications list a service. */
export type ListingApplication = Pick<DeployApplication, "name" | "subgraphs">;

/**
 * Names of the applications whose subgraphs list a service.
 * @param applications - Applications of the config
 * @param type - Subgraph type of the service, such as `tailordb`
 * @param name - Service name
 * @returns The application names, in config order
 */
export function applicationsListing(
  applications: ReadonlyArray<ListingApplication>,
  type: "tailordb" | "pipeline" | "auth" | "idp",
  name: string,
): string[] {
  return applications
    .filter(({ subgraphs }) =>
      subgraphs.some((subgraph) => subgraph.Type === type && subgraph.Name === name),
    )
    .map((application) => application.name);
}

type AuthNamespaceContext = {
  application: Pick<ConfigServices, "authServices">;
  applications: ReadonlyArray<Pick<DeployApplication, "authNamespace">>;
};

/**
 * Get the Auth namespaces that a config's executors, resolvers, and invokers can name: those the
 * config defines, and the external one a `defineConfig()` config references.
 * @param context - Services and applications of the config
 * @returns The Auth namespaces, in config order
 */
export function configAuthNamespaces(context: AuthNamespaceContext): string[] {
  return [
    ...new Set([
      ...context.application.authServices.map((service) => service.config.name),
      ...context.applications.flatMap((app) => (app.authNamespace ? [app.authNamespace] : [])),
    ]),
  ];
}
