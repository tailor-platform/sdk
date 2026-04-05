import { describe, expect, test } from "vitest";
import { summarizePlanResultsForDisplay } from "./apply";
import { formatAuthHookChangeEntries } from "./auth";
import { buildPlannedExecutorsByName, formatExecutorChangeEntries } from "./executor";
import { formatResolverChangeEntries } from "./resolver";
import { formatTailorDBResourceChangeEntries } from "./tailordb";
import { formatWorkflowChangeEntries } from "./workflow";

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
type TailorDBGqlPermissionUpdate = TailorDBGqlPermissionChangeSet["updates"][number];
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

function computeDisplayEntries(results: SummaryPlanResults) {
  return {
    executorEntries: formatExecutorChangeEntries(
      results.executor.changeSet,
      buildPlannedExecutorsByName(results.executor.changeSet),
      results.functionRegistry.executorFunctionChanges,
    ),
    resolverEntries: formatResolverChangeEntries(
      results.pipeline.changeSet.resolver,
      results.functionRegistry.resolverFunctionChanges,
    ),
    workflowEntries: formatWorkflowChangeEntries(
      results.workflow.changeSet,
      results.functionRegistry.workflowJobChanges,
    ),
    authHookEntries: formatAuthHookChangeEntries(
      results.auth.changeSet.authHook,
      results.functionRegistry.authHookFunctionChanges,
    ),
    tailorDBEntries: formatTailorDBResourceChangeEntries(
      results.tailorDB.changeSet.type,
      results.tailorDB.changeSet.gqlPermission,
    ),
  };
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

    const { executorEntries, resolverEntries, workflowEntries, authHookEntries, tailorDBEntries } =
      computeDisplayEntries(results);
    const summary = summarizePlanResultsForDisplay(
      results,
      executorEntries,
      resolverEntries,
      workflowEntries,
      authHookEntries,
      tailorDBEntries,
    );

    expect(summary).toEqual({
      create: 1,
      update: 4,
      delete: 0,
      replace: 0,
      unchanged: 0,
    });
  });

  test("does not count TailorDB unchanged names when the same grouped row has changes", () => {
    const results = {
      functionRegistry: {
        changeSet: createFixtureChangeSet<FunctionRegistryChangeSet>(),
        workflowJobChanges: {
          creates: [],
          updates: [],
          deletes: [],
          replaces: [],
          unchanged: [],
        },
        resolverFunctionChanges: {
          creates: [],
          updates: [],
          deletes: [],
          replaces: [],
          unchanged: [],
        },
        executorFunctionChanges: {
          creates: [],
          updates: [],
          deletes: [],
          replaces: [],
          unchanged: [],
        },
        authHookFunctionChanges: {
          creates: [],
          updates: [],
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
          service: createFixtureChangeSet<TailorDBServiceChangeSet>(),
          type: {
            ...createFixtureChangeSet<TailorDBTypeChangeSet>(),
            unchanged: [{ name: "Project" }],
          },
          gqlPermission: {
            ...createFixtureChangeSet<TailorDBGqlPermissionChangeSet>(),
            updates: [
              {
                name: "Project",
                request: {} as TailorDBGqlPermissionUpdate["request"],
              } satisfies TailorDBGqlPermissionUpdate,
            ],
            unchanged: [{ name: "OtherProject" }],
          },
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
        changeSet: createFixtureChangeSet<StaticWebsiteChangeSet>(),
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      idp: {
        changeSet: {
          service: createFixtureChangeSet<IdPServiceChangeSet>(),
          client: createFixtureChangeSet<IdPClientChangeSet>(),
        },
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      auth: {
        changeSet: {
          service: createFixtureChangeSet<AuthServiceChangeSet>(),
          idpConfig: createFixtureChangeSet<AuthIdpConfigChangeSet>(),
          userProfileConfig: createFixtureChangeSet<AuthUserProfileConfigChangeSet>(),
          tenantConfig: createFixtureChangeSet<AuthTenantConfigChangeSet>(),
          machineUser: createFixtureChangeSet<AuthMachineUserChangeSet>(),
          oauth2Client: createFixtureChangeSet<AuthOauth2ClientChangeSet>(),
          authHook: createFixtureChangeSet<AuthHookChangeSet>(),
          scim: createFixtureChangeSet<AuthScimChangeSet>(),
          scimResource: createFixtureChangeSet<AuthScimResourceChangeSet>(),
        },
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      pipeline: {
        changeSet: {
          service: createFixtureChangeSet<PipelineServiceChangeSet>(),
          resolver: createFixtureChangeSet<ResolverChangeSet>(),
        },
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      app: createFixtureChangeSet<AppChangeSet>(),
      executor: {
        changeSet: createFixtureChangeSet<ExecutorChangeSet>(),
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      workflow: {
        changeSet: createFixtureChangeSet<WorkflowChangeSet>(),
        unchangedWorkflowJobNames: new Set<string>(),
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
        appName: "my-app",
      },
      secretManager: {
        vaultChangeSet: createFixtureChangeSet<VaultChangeSet>(),
        secretChangeSet: createFixtureChangeSet<SecretChangeSet>(),
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
    } satisfies SummaryPlanResults;

    const { executorEntries, resolverEntries, workflowEntries, authHookEntries, tailorDBEntries } =
      computeDisplayEntries(results);
    const summary = summarizePlanResultsForDisplay(
      results,
      executorEntries,
      resolverEntries,
      workflowEntries,
      authHookEntries,
      tailorDBEntries,
    );

    expect(summary).toEqual({
      create: 0,
      update: 1,
      delete: 0,
      replace: 0,
      unchanged: 1,
    });
  });

  test("does not count unchanged grouped resources when only related function registry changes", () => {
    const results = {
      functionRegistry: {
        changeSet: createFixtureChangeSet<FunctionRegistryChangeSet>(),
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
          service: createFixtureChangeSet<TailorDBServiceChangeSet>(),
          type: createFixtureChangeSet<TailorDBTypeChangeSet>(),
          gqlPermission: createFixtureChangeSet<TailorDBGqlPermissionChangeSet>(),
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
        changeSet: createFixtureChangeSet<StaticWebsiteChangeSet>(),
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      idp: {
        changeSet: {
          service: createFixtureChangeSet<IdPServiceChangeSet>(),
          client: createFixtureChangeSet<IdPClientChangeSet>(),
        },
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      auth: {
        changeSet: {
          service: createFixtureChangeSet<AuthServiceChangeSet>(),
          idpConfig: createFixtureChangeSet<AuthIdpConfigChangeSet>(),
          userProfileConfig: createFixtureChangeSet<AuthUserProfileConfigChangeSet>(),
          tenantConfig: createFixtureChangeSet<AuthTenantConfigChangeSet>(),
          machineUser: createFixtureChangeSet<AuthMachineUserChangeSet>(),
          oauth2Client: createFixtureChangeSet<AuthOauth2ClientChangeSet>(),
          authHook: {
            ...createFixtureChangeSet<AuthHookChangeSet>(),
            unchanged: [{ name: "my-auth/before-login" }],
          },
          scim: createFixtureChangeSet<AuthScimChangeSet>(),
          scimResource: createFixtureChangeSet<AuthScimResourceChangeSet>(),
        },
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      pipeline: {
        changeSet: {
          service: createFixtureChangeSet<PipelineServiceChangeSet>(),
          resolver: {
            ...createFixtureChangeSet<ResolverChangeSet>(),
            unchanged: [
              { name: "add", namespaceName: "my-resolver" } as {
                name: string;
                namespaceName: string;
              },
            ],
          },
        },
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      app: createFixtureChangeSet<AppChangeSet>(),
      executor: {
        changeSet: {
          ...createFixtureChangeSet<ExecutorChangeSet>(),
          unchanged: [{ name: "user-created" }],
        },
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      workflow: {
        changeSet: {
          ...createFixtureChangeSet<WorkflowChangeSet>(),
          unchanged: [
            { name: "order-processing", usedJobNames: ["process-order"] } as {
              name: string;
              usedJobNames: string[];
            },
          ],
        },
        unchangedWorkflowJobNames: new Set(["process-order"]),
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
        appName: "my-app",
      },
      secretManager: {
        vaultChangeSet: createFixtureChangeSet<VaultChangeSet>(),
        secretChangeSet: createFixtureChangeSet<SecretChangeSet>(),
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
    } satisfies SummaryPlanResults;

    const { executorEntries, resolverEntries, workflowEntries, authHookEntries, tailorDBEntries } =
      computeDisplayEntries(results);
    const summary = summarizePlanResultsForDisplay(
      results,
      executorEntries,
      resolverEntries,
      workflowEntries,
      authHookEntries,
      tailorDBEntries,
    );

    expect(summary).toEqual({
      create: 0,
      update: 4,
      delete: 0,
      replace: 0,
      unchanged: 0,
    });
  });
});
