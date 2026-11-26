import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { loadConfig, type LoadedConfig } from "#/cli/shared/config-loader";
import type { IdPOwnConfig } from "#/configure/services/idp/types";
import type { ManagedResourceType } from "./managed-resource-type";

type DriftCheckTarget = "example" | "redeploy e2e";

type DriftCheckConfigs = Record<DriftCheckTarget, LoadedConfig>;

/** The config whose redeploy is checked for planned changes, or why no check creates the type. */
type Coverage =
  | { target: DriftCheckTarget; configures: (config: LoadedConfig) => boolean }
  | string;

const repositoryRoot = path.resolve(import.meta.dirname, "../../../../../..");
const TARGET_CONFIG_PATHS: Record<DriftCheckTarget, string> = {
  example: path.join(repositoryRoot, "example/tailor.config.ts"),
  "redeploy e2e": path.join(repositoryRoot, "packages/sdk/e2e/fixtures/redeploy/tailor.config.ts"),
};

const hasEntries = (value: object | undefined): boolean =>
  value !== undefined && Object.keys(value).length > 0;

const ownAuth = (config: LoadedConfig) =>
  config.auth && !("external" in config.auth) ? config.auth : undefined;

const ownIdps = (config: LoadedConfig) =>
  [config.idp ?? []].flat().filter((idp): idp is IdPOwnConfig => !("external" in idp));

const hasOwnServices = (services: Record<string, object> | undefined): boolean =>
  Object.values(services ?? {}).some((service) => !("external" in service));

// Rows for resources defined in code check only that the file globs are configured.
const COVERAGE: Record<ManagedResourceType, Coverage> = {
  aigateway: { target: "example", configures: (config) => (config.aiGateways?.length ?? 0) > 0 },
  application: { target: "example", configures: () => true },
  "auth.connection": {
    target: "redeploy e2e",
    configures: (config) => hasEntries(ownAuth(config)?.connections),
  },
  "auth.hook": {
    target: "example",
    configures: (config) => ownAuth(config)?.hooks?.beforeLogin !== undefined,
  },
  "auth.idp_config": {
    target: "example",
    configures: (config) => ownAuth(config)?.idProvider !== undefined,
  },
  "auth.machine_user": {
    target: "example",
    configures: (config) => hasEntries(ownAuth(config)?.machineUsers),
  },
  "auth.oauth2_client": {
    target: "example",
    configures: (config) => hasEntries(ownAuth(config)?.oauth2Clients),
  },
  "auth.scim": { target: "example", configures: (config) => ownAuth(config)?.scim !== undefined },
  "auth.scim_resource": {
    target: "example",
    configures: (config) => (ownAuth(config)?.scim?.resources.length ?? 0) > 0,
  },
  "auth.service": { target: "example", configures: (config) => ownAuth(config) !== undefined },
  "auth.tenant_config": {
    target: "redeploy e2e",
    configures: (config) => ownAuth(config)?.tenantProvider !== undefined,
  },
  "auth.user_profile_config": {
    target: "example",
    configures: (config) => ownAuth(config)?.userProfile !== undefined,
  },
  executor: { target: "example", configures: (config) => config.executor !== undefined },
  function_registry: {
    target: "example",
    configures: (config) => hasOwnServices(config.resolver),
  },
  "idp.client": {
    target: "example",
    configures: (config) => ownIdps(config).some((idp) => idp.clients.length > 0),
  },
  "idp.service": { target: "example", configures: (config) => ownIdps(config).length > 0 },
  "pipeline.resolver": {
    target: "example",
    configures: (config) => hasOwnServices(config.resolver),
  },
  "pipeline.service": {
    target: "example",
    configures: (config) => hasOwnServices(config.resolver),
  },
  "secret.secret": {
    target: "example",
    configures: (config) => Object.values(config.secrets?.vaults ?? {}).some(hasEntries),
  },
  "secret.vault": {
    target: "example",
    configures: (config) => hasEntries(config.secrets?.vaults),
  },
  staticwebsite: {
    target: "example",
    configures: (config) => (config.staticWebsites?.length ?? 0) > 0,
  },
  "staticwebsite.custom_domain":
    "Adding a custom domain registers it with the Platform's CDN, so a run needs a domain the organization owns, and a domain can exist only once across the Platform.",
  "staticwebsite.custom_domain_transfer":
    "A transfer moves a custom domain between workspaces, so it needs a custom domain.",
  "tailordb.gql_permission": {
    target: "example",
    configures: (config) => hasOwnServices(config.db),
  },
  "tailordb.replication":
    "The Platform rejects TailorDB replications in a workspace unless a feature flag allows them.",
  "tailordb.replication_destination":
    "The Platform rejects creating a TailorDB replication destination unless the replication feature flag allows it.",
  "tailordb.service": { target: "example", configures: (config) => hasOwnServices(config.db) },
  "tailordb.type": { target: "example", configures: (config) => hasOwnServices(config.db) },
  workflow: { target: "example", configures: (config) => config.workflow !== undefined },
  workflow_job_function: {
    target: "example",
    configures: (config) => config.workflow !== undefined,
  },
  workflow_job_function_execution_policy: {
    target: "example",
    configures: (config) => hasEntries(config.workflow?.executionPolicies),
  },
};

function unconfiguredTypes(configs: DriftCheckConfigs): string[] {
  return Object.entries(COVERAGE).flatMap(([resourceType, coverage]) =>
    typeof coverage !== "string" && !coverage.configures(configs[coverage.target])
      ? [resourceType]
      : [],
  );
}

describe("deploy drift checks", () => {
  test("configure every deploy-managed resource type that is not excluded", async () => {
    const [example, redeploy] = await Promise.all([
      loadConfig(TARGET_CONFIG_PATHS.example),
      loadConfig(TARGET_CONFIG_PATHS["redeploy e2e"]),
    ]);

    expect(unconfiguredTypes({ example: example.config, "redeploy e2e": redeploy.config })).toEqual(
      [],
    );
  });

  test("see no resource type other than the application in an empty config", () => {
    const empty: LoadedConfig = { name: "empty", path: "" };
    const checkedTypes = Object.entries(COVERAGE).flatMap(([resourceType, coverage]) =>
      typeof coverage === "string" ? [] : [resourceType],
    );

    expect(
      checkedTypes.filter(
        (resourceType) =>
          !unconfiguredTypes({ example: empty, "redeploy e2e": empty }).includes(resourceType),
      ),
    ).toEqual(["application"]);
  });
});
