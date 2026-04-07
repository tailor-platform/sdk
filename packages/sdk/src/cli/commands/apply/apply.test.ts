import { describe, expect, test } from "vitest";
import { summarizePlanResultsForDisplay } from "./apply";
import { formatAuthHookChangeEntries } from "./auth";
import { createChangeSet } from "./change-set";
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
type AuthConnectionChangeSet = SummaryPlanResults["auth"]["changeSet"]["connection"];
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

function fixture<T>(title = "fixture"): T {
  return createChangeSet(title) as unknown as T;
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
    const functionRegistry = fixture<FunctionRegistryChangeSet>();
    functionRegistry.updates.push({ name: "workflow--process-order" } as FunctionRegistryUpdate);
    functionRegistry.updates.push({ name: "resolver--my-resolver--add" } as FunctionRegistryUpdate);
    functionRegistry.updates.push({ name: "executor--user-created" } as FunctionRegistryUpdate);
    functionRegistry.updates.push({
      name: "auth-hook--my-auth--before-login",
    } as FunctionRegistryUpdate);

    const tailorDBService = fixture<TailorDBServiceChangeSet>();
    const tailorDBType = fixture<TailorDBTypeChangeSet>();
    tailorDBType.creates.push({ name: "Project" } as TailorDBTypeCreate);
    const tailorDBGqlPermission = fixture<TailorDBGqlPermissionChangeSet>();
    tailorDBGqlPermission.creates.push({ name: "Project" } as TailorDBGqlPermissionCreate);

    const staticWebsite = fixture<StaticWebsiteChangeSet>();
    const idpService = fixture<IdPServiceChangeSet>();
    const idpClient = fixture<IdPClientChangeSet>();
    const authService = fixture<AuthServiceChangeSet>();
    const authIdpConfig = fixture<AuthIdpConfigChangeSet>();
    const authUserProfileConfig = fixture<AuthUserProfileConfigChangeSet>();
    const authTenantConfig = fixture<AuthTenantConfigChangeSet>();
    const authMachineUser = fixture<AuthMachineUserChangeSet>();
    const authOauth2Client = fixture<AuthOauth2ClientChangeSet>();
    const authHook = fixture<AuthHookChangeSet>();
    authHook.updates.push({ name: "my-auth/before-login" } as AuthHookUpdate);
    const authScim = fixture<AuthScimChangeSet>();
    const authScimResource = fixture<AuthScimResourceChangeSet>();
    const pipelineService = fixture<PipelineServiceChangeSet>();
    const resolver = fixture<ResolverChangeSet>();
    resolver.updates.push({
      name: "add",
      request: { workspaceId: "ws", namespaceName: "my-resolver" },
    });
    const app = fixture<AppChangeSet>();
    const executor = fixture<ExecutorChangeSet>();
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
    const workflow = fixture<WorkflowChangeSet>();
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
    const vault = fixture<VaultChangeSet>();
    const secret = fixture<SecretChangeSet>();

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
          connection: fixture<AuthConnectionChangeSet>(),
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
        resolverNamespaceMap: new Map<string, string>(),
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
        unchangedWorkflowJobMap: new Map<string, string[]>(),
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
    const summary = summarizePlanResultsForDisplay(results, {
      executorEntries,
      resolverEntries,
      workflowEntries,
      authHookEntries,
      tailorDBEntries,
    });

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
        changeSet: fixture<FunctionRegistryChangeSet>(),
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
          service: fixture<TailorDBServiceChangeSet>(),
          type: {
            ...fixture<TailorDBTypeChangeSet>(),
            unchanged: [{ name: "Project" }],
          },
          gqlPermission: {
            ...fixture<TailorDBGqlPermissionChangeSet>(),
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
        changeSet: fixture<StaticWebsiteChangeSet>(),
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      idp: {
        changeSet: {
          service: fixture<IdPServiceChangeSet>(),
          client: fixture<IdPClientChangeSet>(),
        },
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      auth: {
        changeSet: {
          service: fixture<AuthServiceChangeSet>(),
          idpConfig: fixture<AuthIdpConfigChangeSet>(),
          userProfileConfig: fixture<AuthUserProfileConfigChangeSet>(),
          tenantConfig: fixture<AuthTenantConfigChangeSet>(),
          machineUser: fixture<AuthMachineUserChangeSet>(),
          oauth2Client: fixture<AuthOauth2ClientChangeSet>(),
          authHook: fixture<AuthHookChangeSet>(),
          scim: fixture<AuthScimChangeSet>(),
          scimResource: fixture<AuthScimResourceChangeSet>(),
          connection: fixture<AuthConnectionChangeSet>(),
        },
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      pipeline: {
        changeSet: {
          service: fixture<PipelineServiceChangeSet>(),
          resolver: fixture<ResolverChangeSet>(),
        },
        resolverNamespaceMap: new Map<string, string>(),
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      app: fixture<AppChangeSet>(),
      executor: {
        changeSet: fixture<ExecutorChangeSet>(),
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      workflow: {
        changeSet: fixture<WorkflowChangeSet>(),
        unchangedWorkflowJobNames: new Set<string>(),
        unchangedWorkflowJobMap: new Map<string, string[]>(),
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
        appName: "my-app",
      },
      secretManager: {
        vaultChangeSet: fixture<VaultChangeSet>(),
        secretChangeSet: fixture<SecretChangeSet>(),
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
    } satisfies SummaryPlanResults;

    const { executorEntries, resolverEntries, workflowEntries, authHookEntries, tailorDBEntries } =
      computeDisplayEntries(results);
    const summary = summarizePlanResultsForDisplay(results, {
      executorEntries,
      resolverEntries,
      workflowEntries,
      authHookEntries,
      tailorDBEntries,
    });

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
        changeSet: fixture<FunctionRegistryChangeSet>(),
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
          service: fixture<TailorDBServiceChangeSet>(),
          type: fixture<TailorDBTypeChangeSet>(),
          gqlPermission: fixture<TailorDBGqlPermissionChangeSet>(),
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
        changeSet: fixture<StaticWebsiteChangeSet>(),
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      idp: {
        changeSet: {
          service: fixture<IdPServiceChangeSet>(),
          client: fixture<IdPClientChangeSet>(),
        },
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      auth: {
        changeSet: {
          service: fixture<AuthServiceChangeSet>(),
          idpConfig: fixture<AuthIdpConfigChangeSet>(),
          userProfileConfig: fixture<AuthUserProfileConfigChangeSet>(),
          tenantConfig: fixture<AuthTenantConfigChangeSet>(),
          machineUser: fixture<AuthMachineUserChangeSet>(),
          oauth2Client: fixture<AuthOauth2ClientChangeSet>(),
          authHook: {
            ...fixture<AuthHookChangeSet>(),
            unchanged: [{ name: "my-auth/before-login" }],
          },
          scim: fixture<AuthScimChangeSet>(),
          scimResource: fixture<AuthScimResourceChangeSet>(),
          connection: fixture<AuthConnectionChangeSet>(),
        },
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      pipeline: {
        changeSet: {
          service: fixture<PipelineServiceChangeSet>(),
          resolver: {
            ...fixture<ResolverChangeSet>(),
            unchanged: [{ name: "add" }],
          },
        },
        resolverNamespaceMap: new Map([["add", "my-resolver"]]),
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      app: fixture<AppChangeSet>(),
      executor: {
        changeSet: {
          ...fixture<ExecutorChangeSet>(),
          unchanged: [{ name: "user-created" }],
        },
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
      workflow: {
        changeSet: {
          ...fixture<WorkflowChangeSet>(),
          unchanged: [{ name: "order-processing" }],
        },
        unchangedWorkflowJobNames: new Set(["process-order"]),
        unchangedWorkflowJobMap: new Map([["order-processing", ["process-order"]]]),
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
        appName: "my-app",
      },
      secretManager: {
        vaultChangeSet: fixture<VaultChangeSet>(),
        secretChangeSet: fixture<SecretChangeSet>(),
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set<string>(),
      },
    } satisfies SummaryPlanResults;

    const { executorEntries, resolverEntries, workflowEntries, authHookEntries, tailorDBEntries } =
      computeDisplayEntries(results);
    const summary = summarizePlanResultsForDisplay(results, {
      executorEntries,
      resolverEntries,
      workflowEntries,
      authHookEntries,
      tailorDBEntries,
    });

    expect(summary).toEqual({
      create: 0,
      update: 4,
      delete: 0,
      replace: 0,
      unchanged: 0,
    });
  });
});
