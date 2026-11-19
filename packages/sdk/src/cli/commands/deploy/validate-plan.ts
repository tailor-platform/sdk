import {
  create,
  createRegistry,
  type DescMessage,
  type MessageInitShape,
} from "@bufbuild/protobuf";
import { pathToString, usedTypes } from "@bufbuild/protobuf/reflect";
import { createValidator, type Validator } from "@bufbuild/protovalidate";
import {
  CreateAIGatewayRequestSchema,
  UpdateAIGatewayRequestSchema,
} from "@tailor-platform/tailor-proto/aigateway_pb";
import {
  CreateApplicationRequestSchema,
  UpdateApplicationRequestSchema,
} from "@tailor-platform/tailor-proto/application_pb";
import {
  CreateAuthConnectionRequestSchema,
  UpdateAuthConnectionRequestSchema,
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
  CreateFunctionRegistryRequestSchema,
  UpdateFunctionRegistryRequestSchema,
} from "@tailor-platform/tailor-proto/function_registry_pb";
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
  RequestCustomDomainTransferRequestSchema,
  UpdateStaticWebsiteRequestSchema,
} from "@tailor-platform/tailor-proto/staticwebsite_pb";
import {
  CreateTailorDBGQLPermissionRequestSchema,
  CreateTailorDBServiceRequestSchema,
  CreateTailorDBTypeRequestSchema,
  UpdateTailorDBGQLPermissionRequestSchema,
  UpdateTailorDBTypeRequestSchema,
} from "@tailor-platform/tailor-proto/tailordb_pb";
import {
  CreateWorkflowJobFunctionExecutionPolicyRequestSchema,
  CreateWorkflowJobFunctionRequestSchema,
  CreateWorkflowRequestSchema,
  UpdateWorkflowJobFunctionExecutionPolicyRequestSchema,
  UpdateWorkflowRequestSchema,
} from "@tailor-platform/tailor-proto/workflow_pb";
import { CLIError } from "#/cli/shared/errors";
import { logger, styles } from "#/cli/shared/logger";
import { STATIC_WEBSITE_ORIGIN_PLACEHOLDER_PATTERN } from "#/parser/service/common";
import { ALL_EMAIL_DOMAINS, hasImplicitAllEmailDomains } from "#/parser/service/idp/email-domains";
import { functionUploadInfoMessage } from "./function-registry";
import { idpClientSecretName, idpClientVaultName } from "./idp";
import { MANAGED_RESOURCE_LABELS, type ManagedResourceType } from "./managed-resource-type";
import { MANAGED_RESOURCES, type ManagedChangeSetOf } from "./managed-resources";
import { secretCreateRequest, secretUpdateRequest, vaultCreateRequest } from "./secret-manager";
import { buildWorkflowValidationShape } from "./workflow";
import {
  executionPolicyCreateRequest,
  executionPolicyUpdateRequest,
} from "./workflow-execution-policy";
import type { PlanResults } from "./apply-phases";
import type { HasName } from "./change-set";

type Action = "create" | "update" | "replace";

type ViolationEntry = {
  resourceType: ManagedResourceType;
  name: string;
  action: Action;
  fieldPath: string;
  message: string;
};

/** How pre-flight validation checks the items of one change-set list. */
type RequestCheck<Item> = {
  schema: DescMessage;
  /** The request the item sends, or undefined when it sends none. */
  request(item: Item, results: PlanResults): object | undefined;
  /** The action its violations name, when it differs from the list's own. */
  action?: Action;
};

type RequestCheckOptions = Pick<RequestCheck<never>, "action">;

function requestCheck<Desc extends DescMessage, Item>(
  schema: Desc,
  request: (item: Item, results: PlanResults) => MessageInitShape<Desc> | undefined,
  options: RequestCheckOptions = {},
): RequestCheck<Item> {
  return { schema, request, ...options };
}

type CheckedList = "creates" | "updates" | "replaces" | "unchanged";

const LIST_ACTIONS = {
  creates: "create",
  updates: "update",
  replaces: "replace",
  unchanged: "update",
} as const satisfies Record<CheckedList, Action>;

type CheckedChangeSet = Record<CheckedList, ReadonlyArray<HasName>>;

/**
 * The checks of each list a change set can plan. A list whose items send no request with rules
 * declares no checks; `unchanged` items are checked only where deploy sends them again.
 */
type ResourceChecks<C extends CheckedChangeSet> = {
  [L in Exclude<CheckedList, "unchanged"> as C[L][number] extends never ? never : L]: ReadonlyArray<
    RequestCheck<C[L][number]>
  >;
} & { unchanged?: ReadonlyArray<RequestCheck<C["unchanged"][number]>> };

// Static-website URL placeholders in cors are resolved at apply time.
function withoutCors<Request extends { cors?: string[] }>(request: Request): Request {
  return { ...request, cors: undefined };
}

const PLACEHOLDER_ORIGIN = "https://placeholder.invalid";

type IdPServiceRequestInit = Pick<
  MessageInitShape<typeof CreateIdPServiceRequestSchema>,
  "userAuthPolicy"
>;

// `<name>:url` placeholders resolve at apply time; a dummy origin keeps the origin pattern and the
// `enable_mfa` rule checking the rest of the request.
function withPlaceholderOrigins<Request extends IdPServiceRequestInit>(request: Request): Request {
  const origins = request.userAuthPolicy?.allowedReturnOrigins;
  if (!origins?.length) {
    return request;
  }
  return {
    ...request,
    userAuthPolicy: {
      ...request.userAuthPolicy,
      allowedReturnOrigins: origins.map((origin) =>
        STATIC_WEBSITE_ORIGIN_PLACEHOLDER_PATTERN.test(origin) ? PLACEHOLDER_ORIGIN : origin,
      ),
    },
  };
}

type IdPClientSecretNames = { workspaceId: string; namespaceName: string; clientName: string };

// A valid client name can still derive a vault or secret name over the 63-character limit.
function idpClientSecretChecks<Item>(
  namesOf: (item: Item) => IdPClientSecretNames,
): ReadonlyArray<RequestCheck<Item>> {
  const createsSecrets = { action: "create" } as const;
  return [
    requestCheck(
      CreateSecretManagerVaultRequestSchema,
      (item: Item) => {
        const { workspaceId, namespaceName, clientName } = namesOf(item);
        return {
          workspaceId,
          secretmanagerVaultName: idpClientVaultName(namespaceName, clientName),
        };
      },
      createsSecrets,
    ),
    requestCheck(
      CreateSecretManagerSecretRequestSchema,
      (item: Item) => {
        const { workspaceId, namespaceName, clientName } = namesOf(item);
        return {
          workspaceId,
          secretmanagerVaultName: idpClientVaultName(namespaceName, clientName),
          secretmanagerSecretName: idpClientSecretName(namespaceName, clientName),
        };
      },
      createsSecrets,
    ),
  ];
}

// Job functions are registered, in the workspace of the first workflow written, only when a
// workflow is created or updated.
const jobFunctionCheck = requestCheck(
  CreateWorkflowJobFunctionRequestSchema,
  (item: HasName, results) => {
    const { creates, updates } = results.workflow.changeSet;
    const workspaceId = creates[0]?.workspaceId ?? updates[0]?.workspaceId;
    if (!workspaceId) {
      return undefined;
    }
    return { workspaceId, jobFunctionName: item.name, scriptRef: item.name };
  },
  { action: "create" },
);

const applicationUpdateCheck = requestCheck(
  UpdateApplicationRequestSchema,
  (item: ManagedChangeSetOf<"application">["unchanged"][number]) => withoutCors(item.request),
);

// A replace deletes the policy and creates it again.
const executionPolicyCreateCheck = requestCheck(
  CreateWorkflowJobFunctionExecutionPolicyRequestSchema,
  (item: ManagedChangeSetOf<"workflow_job_function_execution_policy">["creates"][number]) =>
    executionPolicyCreateRequest(item.workspaceId, item.policy),
  { action: "create" },
);

/** The requests of each resource type that pre-flight validation checks. */
export const REQUEST_CHECKS = {
  "tailordb.service": {
    creates: [requestCheck(CreateTailorDBServiceRequestSchema, (item) => item.request)],
    // An update writes only the namespace's labels.
    updates: [],
  },
  "tailordb.type": {
    creates: [requestCheck(CreateTailorDBTypeRequestSchema, (item) => item.request)],
    updates: [requestCheck(UpdateTailorDBTypeRequestSchema, (item) => item.request)],
  },
  "tailordb.gql_permission": {
    creates: [requestCheck(CreateTailorDBGQLPermissionRequestSchema, (item) => item.request)],
    updates: [requestCheck(UpdateTailorDBGQLPermissionRequestSchema, (item) => item.request)],
  },
  staticwebsite: {
    creates: [requestCheck(CreateStaticWebsiteRequestSchema, (item) => item.request)],
    updates: [requestCheck(UpdateStaticWebsiteRequestSchema, (item) => item.request)],
  },
  "staticwebsite.custom_domain": {
    creates: [requestCheck(AddCustomDomainRequestSchema, (item) => item.request)],
    // An update adopts the domain by writing only its labels.
    updates: [],
  },
  "staticwebsite.custom_domain_transfer": {
    creates: [requestCheck(RequestCustomDomainTransferRequestSchema, (item) => item.request)],
  },
  aigateway: {
    creates: [requestCheck(CreateAIGatewayRequestSchema, (item) => withoutCors(item.request))],
    updates: [requestCheck(UpdateAIGatewayRequestSchema, (item) => withoutCors(item.request))],
  },
  "idp.service": {
    creates: [
      requestCheck(CreateIdPServiceRequestSchema, (item) => withPlaceholderOrigins(item.request)),
    ],
    updates: [
      requestCheck(UpdateIdPServiceRequestSchema, (item) => withPlaceholderOrigins(item.request)),
    ],
  },
  "idp.client": {
    creates: idpClientSecretChecks((item) => ({
      workspaceId: item.request.workspaceId ?? "",
      namespaceName: item.request.namespaceName ?? "",
      clientName: item.request.client?.name ?? "",
    })),
    updates: idpClientSecretChecks((item) => ({
      workspaceId: item.workspaceId,
      namespaceName: item.namespaceName,
      clientName: item.name,
    })),
  },
  "auth.service": {
    creates: [requestCheck(CreateAuthServiceRequestSchema, (item) => item.request)],
    updates: [requestCheck(UpdateAuthServiceRequestSchema, (item) => item.request)],
  },
  "auth.idp_config": {
    creates: [requestCheck(CreateAuthIDPConfigRequestSchema, (item) => item.request)],
    updates: [requestCheck(UpdateAuthIDPConfigRequestSchema, (item) => item.request)],
  },
  "auth.user_profile_config": {
    creates: [requestCheck(CreateUserProfileConfigRequestSchema, (item) => item.request)],
    updates: [requestCheck(UpdateUserProfileConfigRequestSchema, (item) => item.request)],
  },
  "auth.tenant_config": {
    creates: [requestCheck(CreateTenantConfigRequestSchema, (item) => item.request)],
    updates: [requestCheck(UpdateTenantConfigRequestSchema, (item) => item.request)],
  },
  "auth.machine_user": {
    creates: [requestCheck(CreateAuthMachineUserRequestSchema, (item) => item.request)],
    updates: [requestCheck(UpdateAuthMachineUserRequestSchema, (item) => item.request)],
  },
  "auth.hook": {
    creates: [requestCheck(CreateAuthHookRequestSchema, (item) => item.request)],
    updates: [requestCheck(UpdateAuthHookRequestSchema, (item) => item.request)],
  },
  "auth.scim": {
    creates: [requestCheck(CreateAuthSCIMConfigRequestSchema, (item) => item.request)],
    updates: [requestCheck(UpdateAuthSCIMConfigRequestSchema, (item) => item.request)],
  },
  "auth.scim_resource": {
    creates: [requestCheck(CreateAuthSCIMResourceRequestSchema, (item) => item.request)],
    updates: [requestCheck(UpdateAuthSCIMResourceRequestSchema, (item) => item.request)],
  },
  "auth.oauth2_client": {
    creates: [requestCheck(CreateAuthOAuth2ClientRequestSchema, (item) => item.request)],
    updates: [requestCheck(UpdateAuthOAuth2ClientRequestSchema, (item) => item.request)],
    replaces: [requestCheck(CreateAuthOAuth2ClientRequestSchema, (item) => item.createRequest)],
  },
  "pipeline.service": {
    creates: [requestCheck(CreatePipelineServiceRequestSchema, (item) => item.request)],
    updates: [requestCheck(UpdatePipelineServiceRequestSchema, (item) => item.request)],
  },
  "pipeline.resolver": {
    creates: [requestCheck(CreatePipelineResolverRequestSchema, (item) => item.request)],
    updates: [requestCheck(UpdatePipelineResolverRequestSchema, (item) => item.request)],
  },
  executor: {
    creates: [requestCheck(CreateExecutorExecutorRequestSchema, (item) => item.request)],
    updates: [requestCheck(UpdateExecutorExecutorRequestSchema, (item) => item.request)],
  },
  workflow: {
    creates: [
      requestCheck(CreateWorkflowRequestSchema, (item) =>
        buildWorkflowValidationShape(item.workspaceId, item.workflow),
      ),
    ],
    updates: [
      requestCheck(UpdateWorkflowRequestSchema, (item) =>
        buildWorkflowValidationShape(item.workspaceId, item.workflow),
      ),
    ],
  },
  workflow_job_function: {
    creates: [jobFunctionCheck],
    updates: [jobFunctionCheck],
    unchanged: [jobFunctionCheck],
  },
  workflow_job_function_execution_policy: {
    creates: [executionPolicyCreateCheck],
    updates: [
      requestCheck(UpdateWorkflowJobFunctionExecutionPolicyRequestSchema, (item) =>
        executionPolicyUpdateRequest(item.workspaceId, item.policy),
      ),
    ],
    replaces: [executionPolicyCreateCheck],
  },
  "secret.vault": {
    creates: [requestCheck(CreateSecretManagerVaultRequestSchema, vaultCreateRequest)],
    // An update writes only the vault's labels.
    updates: [],
  },
  "secret.secret": {
    creates: [requestCheck(CreateSecretManagerSecretRequestSchema, secretCreateRequest)],
    updates: [requestCheck(UpdateSecretManagerSecretRequestSchema, secretUpdateRequest)],
  },
  application: {
    creates: [requestCheck(CreateApplicationRequestSchema, (item) => withoutCors(item.request))],
    updates: [applicationUpdateCheck],
    // Apply sends an unchanged application's update again.
    unchanged: [applicationUpdateCheck],
  },
  "auth.connection": {
    creates: [requestCheck(CreateAuthConnectionRequestSchema, (item) => item.request)],
    updates: [requestCheck(UpdateAuthConnectionRequestSchema, (item) => item.request)],
  },
  function_registry: {
    creates: [requestCheck(CreateFunctionRegistryRequestSchema, functionUploadInfoMessage)],
    updates: [requestCheck(UpdateFunctionRegistryRequestSchema, functionUploadInfoMessage)],
  },
} satisfies { [T in ManagedResourceType]: ResourceChecks<ManagedChangeSetOf<T>> };

// IdP client violations are about the Secret Manager names derived from the client.
function violationLabel(resourceType: ManagedResourceType): string {
  const label = MANAGED_RESOURCE_LABELS[resourceType];
  return resourceType === "idp.client" ? `${label} secret` : label;
}

const validators = new Map<string, Validator>();

// A validator's CEL environment snapshots its registry at construction, leaving types the
// validator discovers later unresolvable in CEL. Message-level rules that name a
// fully-qualified enum — AuthOAuth2Client's `browser_client_cannot_require_dpop` — then fail
// with "unresolved attribute", so seed each schema's registry with its transitive types.
function validatorFor(schema: DescMessage): Validator {
  const cached = validators.get(schema.typeName);
  if (cached) {
    return cached;
  }
  const validator = createValidator({ registry: createRegistry(schema, ...usedTypes(schema)) });
  validators.set(schema.typeName, validator);
  return validator;
}

// Reported by idpEmailDomainViolations, which also covers a request without userAuthPolicy.
const SDK_REPORTED_RULE_IDS: ReadonlySet<string> = new Set(["allowed_email_domains_required"]);

type ValidateItemsParams = {
  application: string;
  results: PlanResults;
  resourceType: ManagedResourceType;
  action: Action;
  check: RequestCheck<HasName>;
  items: ReadonlyArray<HasName>;
  violations: ViolationEntry[];
};

function validateItems(params: ValidateItemsParams): void {
  const { application, results, resourceType, action, check, items, violations } = params;
  for (const item of items) {
    const init = check.request(item, results);
    if (init === undefined) {
      continue;
    }
    const result = validatorFor(check.schema).validate(
      check.schema,
      create(check.schema, init as never),
    );
    if (result.kind === "invalid") {
      for (const v of result.violations) {
        if (SDK_REPORTED_RULE_IDS.has(v.ruleId)) {
          continue;
        }
        violations.push({
          resourceType,
          name: item.name,
          action,
          fieldPath: v.field.length > 0 ? pathToString(v.field) : "(message)",
          message: v.message,
        });
      }
    } else if (result.kind === "error") {
      // Evaluator failures must not block deploys; the platform stays the authoritative validator.
      logger.warn(
        `Application "${application}": Could not validate ${violationLabel(resourceType)} "${item.name}" (${action}): ${result.error.message}`,
      );
    }
  }
}

function idpEmailDomainViolations(results: PlanResults): ViolationEntry[] {
  const { service } = results.idp.changeSet;
  return (["creates", "updates"] as const).flatMap((list) =>
    service[list]
      .filter((item) => hasImplicitAllEmailDomains(item.request.userAuthPolicy))
      .map((item) => ({
        resourceType: "idp.service" as const,
        name: item.name,
        action: LIST_ACTIONS[list],
        fieldPath: "userAuthPolicy.allowedEmailDomains",
        message: `must be set unless useNonEmailIdentifier is true; use ["${ALL_EMAIL_DOMAINS}"] to allow every email domain, or list the domains you accept`,
      })),
  );
}

/**
 * Validate the requests that a deployment's plan sends against the buf.validate rules embedded
 * in the generated proto descriptors, and the SDK's own IdP email-domain rule.
 * @param application - Application the plan belongs to
 * @param results - Plan results of one deployment
 * @returns Violations found in the deployment's requests
 */
function collectViolations(application: string, results: PlanResults): ViolationEntry[] {
  const violations: ViolationEntry[] = [];
  for (const resourceType of Object.keys(REQUEST_CHECKS) as ManagedResourceType[]) {
    const checks: Partial<Record<CheckedList, ReadonlyArray<RequestCheck<HasName>>>> =
      REQUEST_CHECKS[resourceType];
    const changeSet: CheckedChangeSet = MANAGED_RESOURCES[resourceType].changeSetOf(results);
    for (const list of Object.keys(LIST_ACTIONS) as CheckedList[]) {
      for (const check of checks[list] ?? []) {
        validateItems({
          application,
          results,
          resourceType,
          action: check.action ?? LIST_ACTIONS[list],
          check,
          items: changeSet[list],
          violations,
        });
      }
    }
  }
  violations.push(...idpEmailDomainViolations(results));
  return violations;
}

/** A deployment's plan results, with the application they belong to. */
export type PlanToValidate = {
  application: string;
  results: PlanResults;
};

/**
 * Validate the planned requests of every deployment before any of them is applied.
 * @param plans - Plan results of each deployment in the run
 */
export async function validatePlans(plans: ReadonlyArray<PlanToValidate>): Promise<void> {
  const violations = plans.flatMap((plan) =>
    collectViolations(plan.application, plan.results).map((v) => ({
      application: plan.application,
      ...v,
    })),
  );
  if (violations.length === 0) {
    return;
  }

  const resourceKeys = new Set(
    violations.map((v) => JSON.stringify([v.application, v.resourceType, v.name])),
  );
  logger.error(
    `Pre-flight validation found ${violations.length} violation(s) across ${resourceKeys.size} resource(s):`,
  );
  const grouped = plans.length > 1;
  const indent = grouped ? "    " : "  ";
  let headedApplication: string | undefined;
  for (const v of violations) {
    if (grouped && v.application !== headedApplication) {
      headedApplication = v.application;
      logger.log(`  Application ${styles.info(`"${headedApplication}"`)}:`);
    }
    logger.log(
      `${indent}${styles.resourceType(violationLabel(v.resourceType))} ${styles.resourceName(v.name)} ` +
        `(${v.action}) — ${styles.bold(v.fieldPath)}: ${v.message}`,
    );
  }

  throw CLIError({
    code: "DEPLOY_VALIDATION_FAILED",
    message: `${violations.length} validation error(s) found in ${resourceKeys.size} resource(s)`,
    context: { issues: violations },
  });
}
