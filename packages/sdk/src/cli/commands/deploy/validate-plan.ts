import { create, type DescMessage } from "@bufbuild/protobuf";
import { pathToString } from "@bufbuild/protobuf/reflect";
import { createValidator, type Validator } from "@bufbuild/protovalidate";
import {
  CreateApplicationRequestSchema,
  UpdateApplicationRequestSchema,
} from "@tailor-platform/tailor-proto/application_pb";
import {
  CreateAuthConnectionRequestSchema,
  CreateAuthHookRequestSchema,
  CreateAuthIDPConfigRequestSchema,
  CreateAuthMachineUserRequestSchema,
  CreateAuthOAuth2ClientRequestSchema,
  CreateAuthSCIMConfigRequestSchema,
  CreateAuthSCIMResourceRequestSchema,
  CreateAuthServiceRequestSchema,
  CreateTenantConfigRequestSchema,
  CreateUserProfileConfigRequestSchema,
  UpdateAuthHookRequestSchema,
  UpdateAuthIDPConfigRequestSchema,
  UpdateAuthMachineUserRequestSchema,
  UpdateAuthOAuth2ClientRequestSchema,
  UpdateAuthSCIMConfigRequestSchema,
  UpdateAuthSCIMResourceRequestSchema,
  UpdateAuthServiceRequestSchema,
  UpdateTenantConfigRequestSchema,
  UpdateUserProfileConfigRequestSchema,
} from "@tailor-platform/tailor-proto/auth_pb";
import {
  CreateExecutorExecutorRequestSchema,
  UpdateExecutorExecutorRequestSchema,
} from "@tailor-platform/tailor-proto/executor_pb";
import {
  CreateIdPServiceRequestSchema,
  UpdateIdPServiceRequestSchema,
} from "@tailor-platform/tailor-proto/idp_pb";
import {
  CreatePipelineResolverRequestSchema,
  CreatePipelineServiceRequestSchema,
  UpdatePipelineResolverRequestSchema,
  UpdatePipelineServiceRequestSchema,
} from "@tailor-platform/tailor-proto/pipeline_pb";
import {
  CreateSecretManagerSecretRequestSchema,
  CreateSecretManagerVaultRequestSchema,
  UpdateSecretManagerSecretRequestSchema,
} from "@tailor-platform/tailor-proto/secret_manager_pb";
import {
  AddCustomDomainRequestSchema,
  CreateStaticWebsiteRequestSchema,
  UpdateStaticWebsiteRequestSchema,
} from "@tailor-platform/tailor-proto/staticwebsite_pb";
import {
  CreateTailorDBServiceRequestSchema,
  CreateTailorDBTypeRequestSchema,
  UpdateTailorDBTypeRequestSchema,
} from "@tailor-platform/tailor-proto/tailordb_pb";
import {
  CreateWorkflowJobFunctionRequestSchema,
  CreateWorkflowRequestSchema,
  UpdateWorkflowRequestSchema,
} from "@tailor-platform/tailor-proto/workflow_pb";
import { logger, styles } from "#/cli/shared/logger";
import { idpClientSecretName, idpClientVaultName } from "./idp";
import { secretCreateRequest, secretUpdateRequest, vaultCreateRequest } from "./secret-manager";
import { buildWorkflowValidationShape } from "./workflow";
import type { planApplication } from "./application";
import type { planAuth } from "./auth";
import type { planExecutor } from "./executor";
import type { planFunctionRegistry } from "./function-registry";
import type { planIdP } from "./idp";
import type { planPipeline } from "./resolver";
import type { planSecretManager } from "./secret-manager";
import type { planStaticWebsite } from "./staticwebsite";
import type { planTailorDB } from "./tailordb/index";
import type { planWorkflow } from "./workflow";

/** Plan results passed to validatePlan. */
export type ValidatePlanInput = {
  functionRegistry: Awaited<ReturnType<typeof planFunctionRegistry>>;
  tailorDB: Awaited<ReturnType<typeof planTailorDB>>;
  staticWebsite: Awaited<ReturnType<typeof planStaticWebsite>>;
  idp: Awaited<ReturnType<typeof planIdP>>;
  auth: Awaited<ReturnType<typeof planAuth>>;
  pipeline: Awaited<ReturnType<typeof planPipeline>>;
  app: Awaited<ReturnType<typeof planApplication>>;
  executor: Awaited<ReturnType<typeof planExecutor>>;
  workflow: Awaited<ReturnType<typeof planWorkflow>>;
  secretManager: Awaited<ReturnType<typeof planSecretManager>>;
};

type ViolationEntry = {
  kind: string;
  name: string;
  action: "create" | "update" | "replace";
  fieldPath: string;
  message: string;
};

type HasRequest = { name: string; request: unknown };
type HasCreateRequest = { name: string; createRequest: unknown };

type ValidateItemsParams<Desc extends DescMessage> = {
  validator: Validator;
  schema: Desc;
  kind: string;
  action: "create" | "update" | "replace";
  items: ReadonlyArray<HasRequest | HasCreateRequest>;
  requestKey: "request" | "createRequest";
  violations: ViolationEntry[];
};

function validateItems<Desc extends DescMessage>(params: ValidateItemsParams<Desc>): void {
  const { validator, schema, kind, action, items, requestKey, violations } = params;
  for (const item of items) {
    const init = (item as Record<string, unknown>)[requestKey];
    const msg = create(schema, init as never);
    const result = validator.validate(schema, msg);
    if (result.kind === "invalid") {
      for (const v of result.violations) {
        violations.push({
          kind,
          name: item.name,
          action,
          fieldPath: v.field.length > 0 ? pathToString(v.field) : "(message)",
          message: v.message,
        });
      }
    } else if (result.kind === "error") {
      // Evaluator failures must not block deploys; the platform stays the authoritative validator.
      logger.warn(`Could not validate ${kind} "${item.name}" (${action}): ${result.error.message}`);
    }
  }
}

/**
 * Validate all plan-time create/update requests against buf.validate constraints embedded in the
 * generated proto descriptors.
 *
 * Collections not validated: idp client, tailorDB gqlPermission, functionRegistry — no
 * buf.validate annotations.
 * Application cors and IdP userAuthPolicy.allowedReturnOrigins receive special
 * handling: static-website URL placeholders are resolved at apply time, so the
 * relevant origin/URL constraints would false-positive on `<name>:url` entries
 * here. Application cors is dropped entirely (no other constraint to lose); IdP
 * `allowedReturnOrigins` substitutes placeholder entries with a dummy origin so
 * the per-item regex and the cross-field `enable_mfa requires ≥1 origin` rule
 * still get exercised on the rest of the payload.
 * Workflow jobFunctions map excluded: versions are registered at apply time (registerJobFunctions)
 * and the map field carries no min_items constraint. Job names are validated separately via
 * CreateWorkflowJobFunctionRequestSchema using usedJobNames from the workflow change set.
 * auth idpConfig.config (provider oneof) is absent at plan time for BuiltInIdP but carries no
 * required constraint — the request is validated as-is from the changeset.
 *
 * @param input - Plan results from the plan phase
 */
export async function validatePlan(input: ValidatePlanInput): Promise<void> {
  const { tailorDB, staticWebsite, idp, auth, pipeline, app, executor, workflow, secretManager } =
    input;

  const validator = createValidator();
  const violations: ViolationEntry[] = [];

  function creates<Desc extends DescMessage>(
    schema: Desc,
    kind: string,
    items: ReadonlyArray<HasRequest>,
  ): void {
    validateItems({
      validator,
      schema,
      kind,
      action: "create",
      items,
      requestKey: "request",
      violations,
    });
  }

  function updates<Desc extends DescMessage>(
    schema: Desc,
    kind: string,
    items: ReadonlyArray<HasRequest>,
  ): void {
    validateItems({
      validator,
      schema,
      kind,
      action: "update",
      items,
      requestKey: "request",
      violations,
    });
  }

  function replaces<Desc extends DescMessage>(
    schema: Desc,
    kind: string,
    items: ReadonlyArray<HasCreateRequest>,
  ): void {
    validateItems({
      validator,
      schema,
      kind,
      action: "replace",
      items,
      requestKey: "createRequest",
      violations,
    });
  }

  // TailorDB service creates (UpdateService has no request field — only metaRequest)
  creates(
    CreateTailorDBServiceRequestSchema,
    "TailorDB service",
    tailorDB.changeSet.service.creates as HasRequest[],
  );

  creates(
    CreateTailorDBTypeRequestSchema,
    "TailorDB type",
    tailorDB.changeSet.type.creates as HasRequest[],
  );
  updates(
    UpdateTailorDBTypeRequestSchema,
    "TailorDB type",
    tailorDB.changeSet.type.updates as HasRequest[],
  );

  creates(
    CreateStaticWebsiteRequestSchema,
    "StaticWebsite",
    staticWebsite.changeSet.creates as HasRequest[],
  );
  updates(
    UpdateStaticWebsiteRequestSchema,
    "StaticWebsite",
    staticWebsite.changeSet.updates as HasRequest[],
  );
  creates(
    AddCustomDomainRequestSchema,
    "StaticWebsite custom domain",
    staticWebsite.customDomainChangeSet.creates as HasRequest[],
  );

  // userAuthPolicy.allowedReturnOrigins: static-website URL placeholders
  // (`<name>:url`) are resolved at apply time. Substitute them with a dummy
  // origin so the per-item origin regex passes and the cross-field
  // `enable_mfa requires ≥1 origin` rule still sees a non-empty list; real
  // (non-placeholder) entries pass through unchanged.
  const placeholderOriginReplacement = "https://placeholder.invalid";
  const substituteIdpReturnOrigins = (item: HasRequest): HasRequest => {
    const request = item.request as { userAuthPolicy?: Record<string, unknown> };
    const origins = request.userAuthPolicy?.allowedReturnOrigins;
    if (!Array.isArray(origins) || origins.length === 0) {
      return item;
    }
    // Match the parser schema's placeholder shape exactly (a static-website
    // slug followed by `:url`, no path/query/fragment). A broader regex would
    // mask schema-rejected inputs that should still surface here as
    // validation errors.
    const substituted = origins.map((origin) =>
      typeof origin === "string" && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]:url$/.test(origin)
        ? placeholderOriginReplacement
        : origin,
    );
    return {
      ...item,
      request: {
        ...request,
        userAuthPolicy: { ...request.userAuthPolicy, allowedReturnOrigins: substituted },
      },
    };
  };
  creates(
    CreateIdPServiceRequestSchema,
    "IdP service",
    (idp.changeSet.service.creates as HasRequest[]).map(substituteIdpReturnOrigins),
  );
  updates(
    UpdateIdPServiceRequestSchema,
    "IdP service",
    (idp.changeSet.service.updates as HasRequest[]).map(substituteIdpReturnOrigins),
  );

  // Validate Secret Manager vault/secret names derived from IdP client creates and updates.
  // The client name itself may be valid while the derived vault/secret name exceeds 63 chars.
  const idpClientVaultItems = [
    ...idp.changeSet.client.creates.map((c) => ({
      clientName: c.request.client?.name ?? "",
      namespaceName: c.request.namespaceName ?? "",
      workspaceId: c.request.workspaceId ?? "",
    })),
    ...idp.changeSet.client.updates.map((u) => ({
      clientName: u.name,
      namespaceName: u.namespaceName,
      workspaceId: u.workspaceId,
    })),
  ];
  creates(
    CreateSecretManagerVaultRequestSchema,
    "IdP client secret",
    idpClientVaultItems.map((item) => ({
      name: item.clientName,
      request: {
        workspaceId: item.workspaceId,
        secretmanagerVaultName: idpClientVaultName(item.namespaceName, item.clientName),
      },
    })),
  );
  creates(
    CreateSecretManagerSecretRequestSchema,
    "IdP client secret",
    idpClientVaultItems.map((item) => ({
      name: item.clientName,
      request: {
        workspaceId: item.workspaceId,
        secretmanagerVaultName: idpClientVaultName(item.namespaceName, item.clientName),
        secretmanagerSecretName: idpClientSecretName(item.namespaceName, item.clientName),
      },
    })),
  );

  creates(
    CreateAuthServiceRequestSchema,
    "Auth service",
    auth.changeSet.service.creates as HasRequest[],
  );
  updates(
    UpdateAuthServiceRequestSchema,
    "Auth service",
    auth.changeSet.service.updates as HasRequest[],
  );

  creates(
    CreateAuthIDPConfigRequestSchema,
    "Auth IDP config",
    auth.changeSet.idpConfig.creates as HasRequest[],
  );
  updates(
    UpdateAuthIDPConfigRequestSchema,
    "Auth IDP config",
    auth.changeSet.idpConfig.updates as HasRequest[],
  );

  creates(
    CreateUserProfileConfigRequestSchema,
    "Auth user profile config",
    auth.changeSet.userProfileConfig.creates as HasRequest[],
  );
  updates(
    UpdateUserProfileConfigRequestSchema,
    "Auth user profile config",
    auth.changeSet.userProfileConfig.updates as HasRequest[],
  );

  creates(
    CreateTenantConfigRequestSchema,
    "Auth tenant config",
    auth.changeSet.tenantConfig.creates as HasRequest[],
  );
  updates(
    UpdateTenantConfigRequestSchema,
    "Auth tenant config",
    auth.changeSet.tenantConfig.updates as HasRequest[],
  );

  creates(
    CreateAuthMachineUserRequestSchema,
    "Auth machine user",
    auth.changeSet.machineUser.creates as HasRequest[],
  );
  updates(
    UpdateAuthMachineUserRequestSchema,
    "Auth machine user",
    auth.changeSet.machineUser.updates as HasRequest[],
  );

  creates(
    CreateAuthHookRequestSchema,
    "Auth hook",
    auth.changeSet.authHook.creates as HasRequest[],
  );
  updates(
    UpdateAuthHookRequestSchema,
    "Auth hook",
    auth.changeSet.authHook.updates as HasRequest[],
  );

  creates(
    CreateAuthSCIMConfigRequestSchema,
    "Auth SCIM config",
    auth.changeSet.scim.creates as HasRequest[],
  );
  updates(
    UpdateAuthSCIMConfigRequestSchema,
    "Auth SCIM config",
    auth.changeSet.scim.updates as HasRequest[],
  );

  creates(
    CreateAuthSCIMResourceRequestSchema,
    "Auth SCIM resource",
    auth.changeSet.scimResource.creates as HasRequest[],
  );
  updates(
    UpdateAuthSCIMResourceRequestSchema,
    "Auth SCIM resource",
    auth.changeSet.scimResource.updates as HasRequest[],
  );

  creates(
    CreateAuthOAuth2ClientRequestSchema,
    "OAuth2 client",
    auth.changeSet.oauth2Client.creates as HasRequest[],
  );
  updates(
    UpdateAuthOAuth2ClientRequestSchema,
    "OAuth2 client",
    auth.changeSet.oauth2Client.updates as HasRequest[],
  );
  replaces(
    CreateAuthOAuth2ClientRequestSchema,
    "OAuth2 client",
    auth.changeSet.oauth2Client.replaces as HasCreateRequest[],
  );

  creates(
    CreatePipelineServiceRequestSchema,
    "Pipeline service",
    pipeline.changeSet.service.creates as HasRequest[],
  );
  updates(
    UpdatePipelineServiceRequestSchema,
    "Pipeline service",
    pipeline.changeSet.service.updates as HasRequest[],
  );
  creates(
    CreatePipelineResolverRequestSchema,
    "Resolver",
    pipeline.changeSet.resolver.creates as HasRequest[],
  );
  updates(
    UpdatePipelineResolverRequestSchema,
    "Resolver",
    pipeline.changeSet.resolver.updates as HasRequest[],
  );

  creates(
    CreateExecutorExecutorRequestSchema,
    "Executor",
    executor.changeSet.creates as HasRequest[],
  );
  updates(
    UpdateExecutorExecutorRequestSchema,
    "Executor",
    executor.changeSet.updates as HasRequest[],
  );

  creates(
    CreateWorkflowRequestSchema,
    "Workflow",
    workflow.changeSet.creates.map((item) => ({
      name: item.name,
      request: buildWorkflowValidationShape(item.workspaceId, item.workflow),
    })),
  );
  updates(
    UpdateWorkflowRequestSchema,
    "Workflow",
    workflow.changeSet.updates.map((item) => ({
      name: item.name,
      request: buildWorkflowValidationShape(item.workspaceId, item.workflow),
    })),
  );

  // Validate job function names using the first workspace that defines them.
  const workflowJobNameWorkspaceId =
    workflow.changeSet.creates[0]?.workspaceId ?? workflow.changeSet.updates[0]?.workspaceId ?? "";
  if (workflowJobNameWorkspaceId) {
    const allJobNames = new Set<string>();
    for (const item of [...workflow.changeSet.creates, ...workflow.changeSet.updates]) {
      for (const jobName of item.usedJobNames) {
        allJobNames.add(jobName);
      }
    }
    for (const jobName of workflow.unchangedWorkflowJobNames) {
      allJobNames.add(jobName);
    }
    creates(
      CreateWorkflowJobFunctionRequestSchema,
      "Workflow job function",
      [...allJobNames].map((jobName) => ({
        name: jobName,
        request: {
          workspaceId: workflowJobNameWorkspaceId,
          jobFunctionName: jobName,
          scriptRef: jobName,
        },
      })),
    );
  }

  creates(
    CreateSecretManagerVaultRequestSchema,
    "Secret Manager vault",
    secretManager.vaultChangeSet.creates.map((item) => ({
      name: item.name,
      request: vaultCreateRequest(item),
    })),
  );
  creates(
    CreateSecretManagerSecretRequestSchema,
    "Secret Manager secret",
    secretManager.secretChangeSet.creates.map((item) => ({
      name: item.name,
      request: secretCreateRequest(item),
    })),
  );
  updates(
    UpdateSecretManagerSecretRequestSchema,
    "Secret Manager secret",
    secretManager.secretChangeSet.updates.map((item) => ({
      name: item.name,
      request: secretUpdateRequest(item),
    })),
  );

  // cors is excluded: static-website URL placeholders are resolved at apply time.
  creates(
    CreateApplicationRequestSchema,
    "Application",
    app.creates.map((item) => ({
      name: item.name,
      request: { ...item.request, cors: undefined },
    })),
  );
  updates(
    UpdateApplicationRequestSchema,
    "Application",
    [...app.updates, ...app.unchanged].map((item) => ({
      name: item.name,
      request: { ...item.request, cors: undefined },
    })),
  );

  creates(
    CreateAuthConnectionRequestSchema,
    "Auth connection",
    auth.changeSet.connection.creates as HasRequest[],
  );
  replaces(
    CreateAuthConnectionRequestSchema,
    "Auth connection",
    auth.changeSet.connection.replaces as HasCreateRequest[],
  );

  if (violations.length === 0) {
    return;
  }

  const resourceNames = new Set(violations.map((v) => `${v.kind}:${v.name}`));
  logger.error(
    `Pre-flight validation found ${violations.length} violation(s) across ${resourceNames.size} resource(s):`,
  );
  for (const v of violations) {
    logger.log(
      `  ${styles.resourceType(v.kind)} ${styles.resourceName(v.name)} ` +
        `(${v.action}) — ${styles.bold(v.fieldPath)}: ${v.message}`,
    );
  }

  throw new Error(
    `${violations.length} validation error(s) found in ${resourceNames.size} resource(s)`,
  );
}
