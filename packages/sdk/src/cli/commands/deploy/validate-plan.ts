import { create, type DescMessage } from "@bufbuild/protobuf";
import { pathToString } from "@bufbuild/protobuf/reflect";
import { createValidator, type Validator } from "@bufbuild/protovalidate";
import {
  CreateAuthHookRequestSchema,
  CreateAuthMachineUserRequestSchema,
  CreateAuthOAuth2ClientRequestSchema,
  CreateAuthSCIMConfigRequestSchema,
  CreateAuthSCIMResourceRequestSchema,
  CreateAuthServiceRequestSchema,
  CreateTenantConfigRequestSchema,
  CreateUserProfileConfigRequestSchema,
  UpdateAuthHookRequestSchema,
  UpdateAuthMachineUserRequestSchema,
  UpdateAuthOAuth2ClientRequestSchema,
  UpdateAuthSCIMConfigRequestSchema,
  UpdateAuthSCIMResourceRequestSchema,
  UpdateAuthServiceRequestSchema,
  UpdateTenantConfigRequestSchema,
  UpdateUserProfileConfigRequestSchema,
} from "@tailor-proto/tailor/v1/auth_pb";
import {
  CreateExecutorExecutorRequestSchema,
  UpdateExecutorExecutorRequestSchema,
} from "@tailor-proto/tailor/v1/executor_pb";
import {
  CreateIdPServiceRequestSchema,
  UpdateIdPServiceRequestSchema,
} from "@tailor-proto/tailor/v1/idp_pb";
import {
  CreatePipelineResolverRequestSchema,
  CreatePipelineServiceRequestSchema,
  UpdatePipelineResolverRequestSchema,
  UpdatePipelineServiceRequestSchema,
} from "@tailor-proto/tailor/v1/pipeline_pb";
import {
  CreateStaticWebsiteRequestSchema,
  UpdateStaticWebsiteRequestSchema,
} from "@tailor-proto/tailor/v1/staticwebsite_pb";
import {
  CreateTailorDBServiceRequestSchema,
  CreateTailorDBTypeRequestSchema,
  UpdateTailorDBTypeRequestSchema,
} from "@tailor-proto/tailor/v1/tailordb_pb";
import { logger, styles } from "@/cli/shared/logger";
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
 * Collections not validated: workflow, app, auth idpConfig/connection, idp client,
 * tailorDB gqlPermission, staticWebsite customDomain, secretManager, functionRegistry —
 * either assembled at apply time or lacking buf.validate annotations.
 *
 * @param input - Plan results from the plan phase
 */
export async function validatePlan(input: ValidatePlanInput): Promise<void> {
  const { tailorDB, staticWebsite, idp, auth, pipeline, executor } = input;

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
    CreateIdPServiceRequestSchema,
    "IdP service",
    idp.changeSet.service.creates as HasRequest[],
  );
  updates(
    UpdateIdPServiceRequestSchema,
    "IdP service",
    idp.changeSet.service.updates as HasRequest[],
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
  validateItems({
    validator,
    schema: CreateAuthOAuth2ClientRequestSchema,
    kind: "OAuth2 client",
    action: "replace",
    items: auth.changeSet.oauth2Client.replaces as HasCreateRequest[],
    requestKey: "createRequest",
    violations,
  });

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
