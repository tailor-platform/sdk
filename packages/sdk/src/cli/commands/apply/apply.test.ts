import { describe, expect, test } from "vitest";
import { summarizePlanResultsForDisplay } from "./apply";

type SummaryPlanResults = Parameters<typeof summarizePlanResultsForDisplay>[0];
type FunctionRegistryChangeSet = SummaryPlanResults["functionRegistry"]["changeSet"];
type TailorDBServiceChangeSet = SummaryPlanResults["tailorDB"]["changeSet"]["service"];
type TailorDBTypeChangeSet = SummaryPlanResults["tailorDB"]["changeSet"]["type"];
type TailorDBGqlPermissionChangeSet = SummaryPlanResults["tailorDB"]["changeSet"]["gqlPermission"];
type StaticWebsiteChangeSet = SummaryPlanResults["staticWebsite"]["changeSet"];
type IdPServiceChangeSet = SummaryPlanResults["idp"]["changeSet"]["service"];
type IdPClientChangeSet = SummaryPlanResults["idp"]["changeSet"]["client"];
type AuthServiceChangeSet = SummaryPlanResults["auth"]["changeSet"]["service"];
type AuthIdpConfigChangeSet = SummaryPlanResults["auth"]["changeSet"]["idpConfig"];
type AuthUserProfileConfigChangeSet = SummaryPlanResults["auth"]["changeSet"]["userProfileConfig"];
type AuthTenantConfigChangeSet = SummaryPlanResults["auth"]["changeSet"]["tenantConfig"];
type AuthMachineUserChangeSet = SummaryPlanResults["auth"]["changeSet"]["machineUser"];
type AuthOauth2ClientChangeSet = SummaryPlanResults["auth"]["changeSet"]["oauth2Client"];
type AuthHookChangeSet = SummaryPlanResults["auth"]["changeSet"]["authHook"];
type AuthScimChangeSet = SummaryPlanResults["auth"]["changeSet"]["scim"];
type AuthScimResourceChangeSet = SummaryPlanResults["auth"]["changeSet"]["scimResource"];
type PipelineServiceChangeSet = SummaryPlanResults["pipeline"]["changeSet"]["service"];
type ResolverChangeSet = SummaryPlanResults["pipeline"]["changeSet"]["resolver"];
type AppChangeSet = SummaryPlanResults["app"];
type ExecutorChangeSet = SummaryPlanResults["executor"]["changeSet"];
type WorkflowChangeSet = SummaryPlanResults["workflow"]["changeSet"];
type VaultChangeSet = SummaryPlanResults["secretManager"]["vaultChangeSet"];
type SecretChangeSet = SummaryPlanResults["secretManager"]["secretChangeSet"];
type FunctionRegistryUpdate = FunctionRegistryChangeSet["updates"][number];
type TailorDBTypeCreate = TailorDBTypeChangeSet["creates"][number];
type TailorDBGqlPermissionCreate = TailorDBGqlPermissionChangeSet["creates"][number];
type AuthHookUpdate = AuthHookChangeSet["updates"][number];
type WorkflowJobFunctionUpdate =
  SummaryPlanResults["functionRegistry"]["workflowJobChanges"]["updates"][number];
type ResolverFunctionUpdate =
  SummaryPlanResults["functionRegistry"]["resolverFunctionChanges"]["updates"][number];
type ExecutorFunctionUpdate =
  SummaryPlanResults["functionRegistry"]["executorFunctionChanges"]["updates"][number];
type AuthHookFunctionUpdate =
  SummaryPlanResults["functionRegistry"]["authHookFunctionChanges"]["updates"][number];

function createFixtureChangeSet<
  T extends {
    title: string;
    creates: Array<{ name: string }>;
    updates: Array<{ name: string }>;
    deletes: Array<{ name: string }>;
    replaces: Array<{ name: string }>;
    unchanged: Array<{ name: string }>;
    isEmpty: () => boolean;
    print: () => void;
  },
>(): T {
  return {
    title: "fixture",
    creates: [],
    updates: [],
    deletes: [],
    replaces: [],
    unchanged: [],
    isEmpty: () => true,
    print: () => {},
  } as unknown as T;
}

describe("summarizePlanResultsForDisplay", () => {
  test("counts grouped display entries instead of raw internal resources", () => {
    const functionRegistry = createFixtureChangeSet<FunctionRegistryChangeSet>();
    functionRegistry.updates.push({ name: "workflow--process-order" } as FunctionRegistryUpdate);
    functionRegistry.updates.push({ name: "resolver--my-resolver--add" } as FunctionRegistryUpdate);
    functionRegistry.updates.push({ name: "executor--user-created" } as FunctionRegistryUpdate);
    functionRegistry.updates.push({
      name: "auth-hook--my-auth--before-login",
    } as FunctionRegistryUpdate);

    const tailorDBService = createFixtureChangeSet<TailorDBServiceChangeSet>();
    const tailorDBType = createFixtureChangeSet<TailorDBTypeChangeSet>();
    tailorDBType.creates.push({ name: "Project" } as TailorDBTypeCreate);
    const tailorDBGqlPermission = createFixtureChangeSet<TailorDBGqlPermissionChangeSet>();
    tailorDBGqlPermission.creates.push({ name: "Project" } as TailorDBGqlPermissionCreate);

    const staticWebsite = createFixtureChangeSet<StaticWebsiteChangeSet>();
    const idpService = createFixtureChangeSet<IdPServiceChangeSet>();
    const idpClient = createFixtureChangeSet<IdPClientChangeSet>();
    const authService = createFixtureChangeSet<AuthServiceChangeSet>();
    const authIdpConfig = createFixtureChangeSet<AuthIdpConfigChangeSet>();
    const authUserProfileConfig = createFixtureChangeSet<AuthUserProfileConfigChangeSet>();
    const authTenantConfig = createFixtureChangeSet<AuthTenantConfigChangeSet>();
    const authMachineUser = createFixtureChangeSet<AuthMachineUserChangeSet>();
    const authOauth2Client = createFixtureChangeSet<AuthOauth2ClientChangeSet>();
    const authHook = createFixtureChangeSet<AuthHookChangeSet>();
    authHook.updates.push({ name: "my-auth/before-login" } as AuthHookUpdate);
    const authScim = createFixtureChangeSet<AuthScimChangeSet>();
    const authScimResource = createFixtureChangeSet<AuthScimResourceChangeSet>();
    const pipelineService = createFixtureChangeSet<PipelineServiceChangeSet>();
    const resolver = createFixtureChangeSet<ResolverChangeSet>();
    resolver.updates.push({
      name: "add",
      request: { workspaceId: "ws", namespaceName: "my-resolver" },
    });
    const app = createFixtureChangeSet<AppChangeSet>();
    const executor = createFixtureChangeSet<ExecutorChangeSet>();
    executor.updates.push({
      name: "user-created",
      request: {
        workspaceId: "ws",
        executor: {
          name: "user-created",
          targetType: 3,
        },
      },
      metaRequest: { trn: "trn", labels: {} },
    });
    const workflow = createFixtureChangeSet<WorkflowChangeSet>();
    workflow.updates.push({
      name: "order-processing",
      workspaceId: "ws",
      workflow: {
        name: "order-processing",
        mainJob: { name: "process-order", body: async () => undefined, trigger: async () => {} },
      },
      usedJobNames: ["process-order"],
      metaRequest: { trn: "trn", labels: {} },
    });
    const vault = createFixtureChangeSet<VaultChangeSet>();
    const secret = createFixtureChangeSet<SecretChangeSet>();

    const results = {
      functionRegistry: {
        changeSet: functionRegistry,
        workflowJobChanges: {
          creates: [],
          updates: [{ name: "workflow--process-order" } as WorkflowJobFunctionUpdate],
          deletes: [],
          replaces: [],
          unchanged: [],
        },
        resolverFunctionChanges: {
          creates: [],
          updates: [{ name: "resolver--my-resolver--add" } as ResolverFunctionUpdate],
          deletes: [],
          replaces: [],
          unchanged: [],
        },
        executorFunctionChanges: {
          creates: [],
          updates: [{ name: "executor--user-created" } as ExecutorFunctionUpdate],
          deletes: [],
          replaces: [],
          unchanged: [],
        },
        authHookFunctionChanges: {
          creates: [],
          updates: [{ name: "auth-hook--my-auth--before-login" } as AuthHookFunctionUpdate],
          deletes: [],
          replaces: [],
          unchanged: [],
        },
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      tailorDB: {
        changeSet: {
          service: tailorDBService,
          type: tailorDBType,
          gqlPermission: tailorDBGqlPermission,
        },
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
        context: {
          workspaceId: "ws",
          application: {} as SummaryPlanResults["tailorDB"]["context"]["application"],
          config: {} as SummaryPlanResults["tailorDB"]["context"]["config"],
          noSchemaCheck: false,
        },
      },
      staticWebsite: {
        changeSet: staticWebsite,
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      idp: {
        changeSet: {
          service: idpService,
          client: idpClient,
        },
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      auth: {
        changeSet: {
          service: authService,
          idpConfig: authIdpConfig,
          userProfileConfig: authUserProfileConfig,
          tenantConfig: authTenantConfig,
          machineUser: authMachineUser,
          oauth2Client: authOauth2Client,
          authHook,
          scim: authScim,
          scimResource: authScimResource,
        },
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      pipeline: {
        changeSet: {
          service: pipelineService,
          resolver,
        },
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      app,
      executor: {
        changeSet: executor,
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      workflow: {
        changeSet: workflow,
        unchangedWorkflowJobNames: new Set<string>(),
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
        appName: "my-app",
      },
      secretManager: {
        vaultChangeSet: vault,
        secretChangeSet: secret,
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
    } satisfies SummaryPlanResults;

    const summary = summarizePlanResultsForDisplay(results);

    expect(summary).toEqual({
      create: 1,
      update: 4,
      delete: 0,
      replace: 0,
      unchanged: 0,
    });
  });
});
