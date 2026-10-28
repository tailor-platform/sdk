import { Code, ConnectError } from "@connectrpc/connect";
import { basename } from "pathe";
import { recoveryContextArgs } from "#/cli/shared/args";
import { getPlatformBaseUrl, initOperatorClient, type OperatorClient } from "#/cli/shared/client";
import {
  loadAccessToken,
  loadPlatformClientConfig,
  tryLoadWorkspaceId,
  type UserWorkspaceDefaults,
} from "#/cli/shared/context";
import {
  CLIError,
  type CLIErrorNextAction,
  formatCommandHint,
  internalError,
} from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { canPrompt, prompt } from "#/cli/shared/prompt";
import {
  announceUserDefaults,
  createValidatedWorkspaceWithClient,
  pointAtUserDefaults,
  resolveWorkspaceCreationLocation,
  userDefaultsContext,
  userDefaultsTarget,
  type ValidatedCreateWorkspaceOptions,
  validateCreateWorkspaceOptions,
  validateWorkspaceName,
} from "../workspace/create";
import { listWorkspacesWithClient } from "../workspace/list";
import { workspaceDisplayName, workspaceInfo, type WorkspaceInfo } from "../workspace/transform";
import {
  loadWorkspaceContext,
  saveWorkspaceContext,
  type WorkspaceContext,
} from "./workspace-context";

export interface ResolveDeployWorkspaceOptions {
  workspaceId?: string;
  profile?: string;
  createWorkspace?: boolean;
  workspaceName?: string;
  workspaceRegion?: string;
  organizationId?: string;
  folderId?: string;
  dryRun?: boolean;
  contextTargets?: readonly WorkspaceContextTarget[];
  deployArgs?: readonly string[];
  workspaceCommandArgs?: readonly string[];
  workspaceCommandJson?: boolean;
}

interface WorkspaceContextTarget {
  configPath: string;
  applicationId: string;
}

type DeployWorkspaceOptions = ResolveDeployWorkspaceOptions & {
  userDefaults?: UserWorkspaceDefaults;
  /** Set once the user defaults have been applied to the organization and folder. */
  locationResolved?: boolean;
};

export interface ResolvedDeployWorkspace {
  client: OperatorClient;
  workspaceId: string;
}

function suggestedWorkspaceName(): string {
  const name = basename(process.cwd())
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/, "");
  return validateWorkspaceName(name) === true ? name : "my-workspace";
}

function executableAction(args: readonly string[]): CLIErrorNextAction {
  return { command: "tailor", args };
}

function deployArgs(options: ResolveDeployWorkspaceOptions): readonly string[] {
  return options.deployArgs ?? ["deploy"];
}

function workspaceCommandArgs(options: ResolveDeployWorkspaceOptions): readonly string[] {
  return options.workspaceCommandArgs ?? [];
}

// Every workspace needs an organization, so once the user defaults have been applied a
// suggested creation command names one, as a placeholder when none was resolved.
function organizationArgs(options: DeployWorkspaceOptions): readonly string[] {
  if (options.organizationId !== undefined) return ["--organization-id", options.organizationId];
  return options.locationResolved ? ["--organization-id", "<organization-id>"] : [];
}

function createDeployArgs(
  options: DeployWorkspaceOptions,
  name: string,
  region: string,
): readonly string[] {
  return [
    ...deployArgs(options),
    "--create-workspace",
    "--workspace-name",
    name,
    "--workspace-region",
    region,
    ...organizationArgs(options),
    ...(options.folderId ? ["--folder-id", options.folderId] : []),
  ];
}

function selectDeployArgs(options: ResolveDeployWorkspaceOptions): readonly string[] {
  return [...deployArgs(options), "--workspace-id", "<workspace-id>"];
}

function userDefaultsDiagnostics(options: DeployWorkspaceOptions, suggestion: string) {
  const defaults = options.userDefaults;
  return defaults
    ? {
        suggestion: `${suggestion} ${userDefaultsTarget(defaults)}`,
        context: userDefaultsContext(defaults),
      }
    : { suggestion, context: {} };
}

function workspaceLabel(workspace: WorkspaceInfo): string {
  const organization = workspace.organizationId ?? "personal";
  return `${workspaceDisplayName(workspace)} (${workspace.region}, org: ${organization}, id: ${workspace.id})`;
}

function workspaceMatchesRequestedIdentity(
  workspace: WorkspaceInfo,
  options: ResolveDeployWorkspaceOptions,
): boolean {
  return (
    options.workspaceName === workspace.name &&
    options.workspaceRegion === workspace.region &&
    options.organizationId === workspace.organizationId &&
    options.folderId === workspace.folderId
  );
}

function workspaceIdentity(workspace: WorkspaceInfo) {
  const { id, name, region, organizationId, folderId } = workspace;
  return { id, name, region, organizationId, folderId };
}

function projectContextTargets(
  contextTargets?: readonly WorkspaceContextTarget[],
): WorkspaceContextTarget[] | undefined {
  if (!contextTargets) return undefined;
  return [...new Map(contextTargets.map((target) => [target.configPath, target])).values()];
}

async function loadProjectContexts(
  platformUrl: string,
  contextTargets?: readonly WorkspaceContextTarget[],
): Promise<WorkspaceContext[]> {
  const targets = projectContextTargets(contextTargets);
  if (!targets || targets.length === 0) {
    const context = await loadWorkspaceContext(platformUrl);
    return context ? [context] : [];
  }
  const contexts = await Promise.all(
    targets.map(({ configPath, applicationId }) =>
      loadWorkspaceContext(platformUrl, configPath, applicationId),
    ),
  );
  return contexts.filter((context): context is WorkspaceContext => context !== undefined);
}

async function persistWorkspaceContext(
  context: WorkspaceContext,
  contextTargets?: readonly WorkspaceContextTarget[],
): Promise<void> {
  const targets = projectContextTargets(contextTargets);
  if (!targets || targets.length === 0) {
    await saveWorkspaceContext(context);
    return;
  }
  const results = await Promise.allSettled(
    targets.map(({ configPath, applicationId }) =>
      saveWorkspaceContext(context, configPath, applicationId),
    ),
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    throw CLIError({
      code: "WORKSPACE_CONTEXT_SAVE_FAILED",
      message: failures
        .map(({ reason }) => (reason instanceof Error ? reason.message : String(reason)))
        .join("; "),
    });
  }
}

async function rememberWorkspaceContext(
  context: WorkspaceContext,
  options: ResolveDeployWorkspaceOptions,
  failurePolicy: "error-on-partial" | "warn" = "error-on-partial",
): Promise<void> {
  if (options.dryRun) return;
  try {
    await persistWorkspaceContext(context, options.contextTargets);
  } catch (error) {
    const contextPathCount = projectContextTargets(options.contextTargets)?.length;
    if ((contextPathCount ?? 0) > 1 && failurePolicy === "error-on-partial") {
      throw CLIError({
        code: "WORKSPACE_CONTEXT_SAVE_FAILED",
        message: "The workspace selection could not be saved for every configuration file.",
        details: error instanceof Error ? error.message : String(error),
        suggestion: "Fix project state permissions, then rerun deploy with the workspace ID.",
        next: executableAction([
          ...deployArgs(options),
          ...recoveryContextArgs({ workspaceId: context.workspaceId }),
        ]),
        context: {
          workspaceId: context.workspaceId,
          configPaths: options.contextTargets?.map(({ configPath }) => configPath),
        },
      });
    }
    logger.warn(
      `Could not save the project workspace selection (${error instanceof Error ? error.message : String(error)}). Continue with --workspace-id ${context.workspaceId} on later runs.`,
    );
  }
}

async function useWorkspace(
  client: OperatorClient,
  platformUrl: string,
  workspace: WorkspaceInfo,
  options: ResolveDeployWorkspaceOptions,
  failurePolicy: "error-on-partial" | "warn" = "error-on-partial",
): Promise<ResolvedDeployWorkspace> {
  await rememberWorkspaceContext(
    {
      version: 1,
      platformUrl,
      workspaceId: workspace.id,
    },
    options,
    failurePolicy,
  );
  logger.info(`Using workspace: ${workspaceLabel(workspace)}`);
  return { client, workspaceId: workspace.id };
}

function useRememberedWorkspace(
  client: OperatorClient,
  workspace: WorkspaceInfo,
): ResolvedDeployWorkspace {
  logger.warn(`Using saved workspace selection: ${workspaceLabel(workspace)}`);
  return { client, workspaceId: workspace.id };
}

const createNewWorkspaceSelection = "create-new-workspace";

async function chooseWorkspace(
  client: OperatorClient,
  platformUrl: string,
  workspaces: readonly WorkspaceInfo[],
  options: DeployWorkspaceOptions,
): Promise<ResolvedDeployWorkspace> {
  const workspaceId = await prompt.select({
    message: "Select a workspace",
    choices: [
      ...workspaces.map((workspace) => ({
        name: workspaceLabel(workspace),
        value: workspace.id,
      })),
      { name: "Create new workspace", value: createNewWorkspaceSelection },
    ],
  });
  if (workspaceId === createNewWorkspaceSelection) {
    return createWorkspaceForDeploy(client, platformUrl, options, true);
  }
  const workspace = workspaces.find(({ id }) => id === workspaceId);
  if (!workspace) throw internalError("Selected workspace was not found");
  return useWorkspace(client, platformUrl, workspace, options);
}

function invalidCreateOptionsError(
  options: DeployWorkspaceOptions,
  name: string,
  region: string,
  details: string,
): Error {
  return CLIError({
    code: "WORKSPACE_CREATE_OPTIONS_INVALID",
    message: "Workspace creation options are invalid.",
    details,
    suggestion: "Correct the workspace creation options and rerun deploy.",
    next: executableAction(createDeployArgs(options, name, region)),
  });
}

/**
 * Ask which organization a new workspace belongs to.
 * @param client - Authenticated Operator client
 * @returns Selected organization ID
 */
async function promptOrganization(client: OperatorClient): Promise<string> {
  const { userOrganizations } = await client.listUserOrganizations({});
  if (userOrganizations.length === 0) {
    throw CLIError({
      code: "WORKSPACE_ORGANIZATION_REQUIRED",
      message: "A workspace must be created in an organization, and this user belongs to none.",
      suggestion: "Ask an organization admin to add this user, then rerun deploy.",
    });
  }
  return prompt.select({
    message: "Organization",
    choices: userOrganizations.map(({ organizationId, organizationName }) => ({
      name: `${organizationName} (${organizationId})`,
      value: organizationId,
    })),
  });
}

/**
 * Resolve the organization a new workspace belongs to: the given one, or the one the user
 * picks in an interactive run that can create a workspace. Otherwise it stays unresolved,
 * and validation rejects the creation with WORKSPACE_CREATE_OPTIONS_INVALID.
 * @param client - Authenticated Operator client
 * @param options - Deploy workspace options
 * @param interactive - Whether the run can prompt
 * @returns Options with the organization resolved where possible
 */
async function resolveCreationOrganization(
  client: OperatorClient,
  options: DeployWorkspaceOptions,
  interactive: boolean,
): Promise<DeployWorkspaceOptions> {
  if (options.organizationId !== undefined || !interactive || options.dryRun) return options;
  return { ...options, organizationId: await promptOrganization(client) };
}

async function createWorkspace(
  client: OperatorClient,
  platformUrl: string,
  requestedOptions: DeployWorkspaceOptions,
  interactive: boolean,
  availableRegions: readonly string[],
  validatedOptions?: ValidatedCreateWorkspaceOptions,
): Promise<ResolvedDeployWorkspace> {
  const options = await resolveCreationOrganization(client, requestedOptions, interactive);
  let name = options.workspaceName;
  let region = options.workspaceRegion;

  if (interactive) {
    name ??= await prompt.text({
      message: "Workspace name",
      default: suggestedWorkspaceName(),
      validate: validateWorkspaceName,
    });
    region ??= await prompt.select({
      message: "Workspace region",
      choices: availableRegions.map((value) => ({ name: value, value })),
    });
  } else {
    const missingOptions = [
      ...(name === undefined ? ["--workspace-name"] : []),
      ...(region === undefined ? ["--workspace-region"] : []),
    ];
    if (missingOptions.length > 0) {
      throw CLIError({
        code: "WORKSPACE_CREATE_OPTIONS_REQUIRED",
        message: "Workspace creation requires a name and region in non-interactive mode.",
        suggestion: "Provide every workspace creation option and rerun deploy.",
        next: executableAction(createDeployArgs(options, name ?? "<name>", region ?? "<region>")),
        context: { missingOptions },
      });
    }
  }

  if (!name || !region) throw internalError("Workspace creation options were not resolved");

  let validated = validatedOptions;
  if (!validated) {
    try {
      validated = validateCreateWorkspaceOptions({
        name,
        region,
        organizationId: options.organizationId,
        folderId: options.folderId,
      });
    } catch (error) {
      throw invalidCreateOptionsError(
        options,
        name,
        region,
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!availableRegions.includes(region)) {
      throw invalidCreateOptionsError(
        options,
        name,
        region,
        `Region must be one of: ${availableRegions.join(", ")}.`,
      );
    }
  }

  if (options.userDefaults) announceUserDefaults(options.userDefaults);
  if (interactive) {
    const scope = [
      options.organizationId ? `organization: ${options.organizationId}` : undefined,
      options.folderId ? `folder: ${options.folderId}` : undefined,
    ].filter((value): value is string => value !== undefined);
    const confirmed = await prompt.confirm({
      message: `Create workspace "${name}" in ${region}${scope.length > 0 ? ` (${scope.join(", ")})` : ""}?`,
      default: true,
    });
    if (!confirmed) {
      throw CLIError({
        code: "WORKSPACE_CREATION_CANCELLED",
        message: "Workspace creation was cancelled.",
      });
    }
  }

  let workspace: WorkspaceInfo;
  try {
    workspace = await createValidatedWorkspaceWithClient(client, validated);
  } catch (error) {
    if (
      error instanceof ConnectError &&
      ![
        Code.Canceled,
        Code.Unknown,
        Code.DeadlineExceeded,
        Code.Aborted,
        Code.Internal,
        Code.Unavailable,
        Code.DataLoss,
      ].includes(error.code)
    ) {
      if (options.userDefaults) pointAtUserDefaults(error, options.userDefaults);
      throw error;
    }
    throw CLIError({
      code: "WORKSPACE_CREATION_FAILED",
      message: "Workspace creation did not complete successfully.",
      details: error instanceof Error ? error.message : String(error),
      suggestion:
        "The outcome may be uncertain. List workspaces before retrying creation to avoid duplicates.",
      next: executableAction(["workspace", "list", ...workspaceCommandArgs(options), "--json"]),
    });
  }

  await rememberWorkspaceContext(
    {
      version: 1,
      platformUrl,
      workspaceId: workspace.id,
    },
    options,
  );
  logger.success(`Created workspace: ${workspaceLabel(workspace)}`);
  logger.info(
    `Reuse this workspace by running ${formatCommandHint({
      command: "tailor",
      args: [
        "deploy",
        ...recoveryContextArgs({ workspaceId: workspace.id, profile: options.profile }),
      ],
    })}`,
  );
  logger.info(`Or set TAILOR_PLATFORM_WORKSPACE_ID=${workspace.id}.`);
  return { client, workspaceId: workspace.id };
}

async function createWorkspaceForDeploy(
  client: OperatorClient,
  platformUrl: string,
  options: DeployWorkspaceOptions,
  interactive: boolean,
  requestedRegions?: readonly string[],
  validatedOptions?: ValidatedCreateWorkspaceOptions,
): Promise<ResolvedDeployWorkspace> {
  const regions = requestedRegions ?? (await client.listAvailableWorkspaceRegions({})).regions;
  if (options.dryRun) {
    throw CLIError({
      code: "WORKSPACE_CREATION_DISABLED_IN_DRY_RUN",
      message: "Dry-run cannot create the workspace required to build a deployment plan.",
      suggestion:
        "Create a workspace explicitly, then rerun the same dry-run with its workspace ID.",
      context: { availableRegions: regions },
    });
  }
  return createWorkspace(client, platformUrl, options, interactive, regions, validatedOptions);
}

/**
 * Resolve or provision the workspace used by deploy.
 * Explicit configuration wins over project context and account discovery.
 * @param input - Deploy workspace selection and creation options
 * @returns Authenticated client and resolved workspace ID
 */
export async function resolveDeployWorkspace(
  input: ResolveDeployWorkspaceOptions = {},
): Promise<ResolvedDeployWorkspace> {
  let options: DeployWorkspaceOptions = input;
  const createOptionNames = [
    options.workspaceName !== undefined ? "--workspace-name" : undefined,
    options.workspaceRegion !== undefined ? "--workspace-region" : undefined,
  ].filter((name): name is string => name !== undefined);
  if (!options.createWorkspace && createOptionNames.length > 0) {
    throw CLIError({
      code: "WORKSPACE_CREATE_FLAG_REQUIRED",
      message: "Workspace creation options require --create-workspace.",
      suggestion: "Add --create-workspace or remove the workspace creation options.",
      next: executableAction(
        createDeployArgs(
          options,
          options.workspaceName ?? "<name>",
          options.workspaceRegion ?? "<region>",
        ),
      ),
      context: { options: createOptionNames },
    });
  }
  if (options.createWorkspace && options.workspaceName !== undefined) {
    const nameValidation = validateWorkspaceName(options.workspaceName);
    if (nameValidation !== true) {
      throw invalidCreateOptionsError(
        options,
        options.workspaceName,
        options.workspaceRegion ?? "<region>",
        nameValidation,
      );
    }
  }
  if (options.createWorkspace && options.workspaceRegion === "") {
    throw invalidCreateOptionsError(
      options,
      options.workspaceName ?? "<name>",
      options.workspaceRegion,
      "Region must not be empty.",
    );
  }

  const explicitWorkspaceId = await tryLoadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });
  const accessToken = await loadAccessToken({ profile: options.profile });
  const platformConfig = await loadPlatformClientConfig({
    profile: options.profile,
    allowMissingProfile: explicitWorkspaceId !== undefined,
  });
  const platformUrl = getPlatformBaseUrl(platformConfig);
  const client = await initOperatorClient(accessToken, platformConfig);

  if (explicitWorkspaceId) {
    let response;
    try {
      response = await client.getWorkspace({ workspaceId: explicitWorkspaceId });
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        throw CLIError({
          code: "WORKSPACE_NOT_FOUND",
          message: `Workspace "${explicitWorkspaceId}" was not found.`,
        });
      }
      throw error;
    }
    if (!response.workspace) {
      throw CLIError({
        code: "WORKSPACE_NOT_FOUND",
        message: `Workspace "${explicitWorkspaceId}" was not found.`,
      });
    }
    return useWorkspace(client, platformUrl, workspaceInfo(response.workspace), options, "warn");
  }

  const location = await resolveWorkspaceCreationLocation(options);
  options = {
    ...options,
    organizationId: location.organizationId,
    folderId: location.folderId,
    userDefaults: location.defaults,
    locationResolved: true,
  };

  const interactive = canPrompt();
  // An explicit creation request needs its organization before the reuse checks below
  // compare existing workspaces against it.
  if (options.createWorkspace) {
    options = await resolveCreationOrganization(client, options, interactive);
  }

  let requestedCreateOptions;
  if (
    options.createWorkspace &&
    options.workspaceName !== undefined &&
    options.workspaceRegion !== undefined
  ) {
    try {
      requestedCreateOptions = validateCreateWorkspaceOptions({
        name: options.workspaceName,
        region: options.workspaceRegion,
        organizationId: options.organizationId,
        folderId: options.folderId,
      });
    } catch (error) {
      throw invalidCreateOptionsError(
        options,
        options.workspaceName,
        options.workspaceRegion,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const [contexts, workspaces] = await Promise.all([
    loadProjectContexts(platformUrl, options.contextTargets),
    listWorkspacesWithClient(client),
  ]);

  const contextWorkspaceIds = new Set(contexts.map(({ workspaceId }) => workspaceId));
  const linkedWorkspace =
    contextWorkspaceIds.size === 1
      ? workspaces.find(({ id }) => contextWorkspaceIds.has(id))
      : undefined;
  if (
    linkedWorkspace &&
    (!options.createWorkspace || workspaceMatchesRequestedIdentity(linkedWorkspace, options))
  ) {
    const contextTargetCount = projectContextTargets(options.contextTargets)?.length ?? 1;
    return contexts.length === contextTargetCount
      ? useRememberedWorkspace(client, linkedWorkspace)
      : useWorkspace(client, platformUrl, linkedWorkspace, options);
  }

  const onlyWorkspace = workspaces.length === 1 ? workspaces[0] : undefined;
  const canReuseOnlyWorkspace =
    onlyWorkspace !== undefined &&
    requestedCreateOptions !== undefined &&
    workspaceMatchesRequestedIdentity(onlyWorkspace, options);
  let requestedRegions: { regions: readonly string[] } | undefined;
  if (requestedCreateOptions && !canReuseOnlyWorkspace) {
    requestedRegions = await client.listAvailableWorkspaceRegions({});
    if (!requestedRegions.regions.includes(requestedCreateOptions.region)) {
      throw invalidCreateOptionsError(
        options,
        requestedCreateOptions.name,
        requestedCreateOptions.region,
        `Region must be one of: ${requestedRegions.regions.join(", ")}.`,
      );
    }
  }

  if (
    workspaces.length === 0 &&
    (interactive || options.createWorkspace || contexts.length === 0)
  ) {
    const regions =
      requestedRegions?.regions ?? (await client.listAvailableWorkspaceRegions({})).regions;
    if (options.dryRun || interactive || options.createWorkspace) {
      return createWorkspaceForDeploy(
        client,
        platformUrl,
        options,
        interactive,
        regions,
        requestedCreateOptions,
      );
    }

    const diagnostics = userDefaultsDiagnostics(
      options,
      "Create one during deploy by providing the workspace name and one of the available regions.",
    );
    throw CLIError({
      code: "WORKSPACE_NOT_FOUND",
      message: "No workspaces are available for this account.",
      suggestion: diagnostics.suggestion,
      next: executableAction(createDeployArgs(options, "<name>", "<region>")),
      context: { availableRegions: regions, ...diagnostics.context },
    });
  }

  if (contextWorkspaceIds.size > 1) {
    const canReplaceStaleContexts =
      options.createWorkspace === true &&
      options.workspaceName !== undefined &&
      options.workspaceRegion !== undefined &&
      workspaces.length === 0;
    if (!interactive && !canReplaceStaleContexts) {
      throw CLIError({
        code: "WORKSPACE_CONTEXT_CONFLICT",
        message: "The deployed configuration files are linked to different workspaces.",
        suggestion: "Choose one workspace explicitly for the combined deployment.",
        next: executableAction(selectDeployArgs(options)),
        context: { savedWorkspaceIds: [...contextWorkspaceIds] },
      });
    }
    if (workspaces.length > 0 && !options.createWorkspace) {
      return chooseWorkspace(client, platformUrl, workspaces, options);
    }
  }

  if (!linkedWorkspace && contexts.length > 0) {
    const explicitlyEnsuringSingleTarget =
      options.createWorkspace === true &&
      options.workspaceName !== undefined &&
      options.workspaceRegion !== undefined &&
      workspaces.length <= 1;
    if (!interactive && !explicitlyEnsuringSingleTarget) {
      throw CLIError({
        code: "WORKSPACE_CONTEXT_STALE",
        message: "The saved project workspace is no longer available.",
        suggestion: "Choose an available workspace explicitly before deploying.",
        next: executableAction(selectDeployArgs(options)),
        context: {
          savedWorkspaceIds: [...contextWorkspaceIds],
          workspaces: workspaces.map(workspaceIdentity),
        },
      });
    }
    if (workspaces.length > 0 && interactive && !options.createWorkspace) {
      return chooseWorkspace(client, platformUrl, workspaces, options);
    }
  }

  if (workspaces.length === 1) {
    const [workspace] = workspaces;
    if (!workspace) throw internalError("Workspace discovery returned an invalid result");

    if (options.createWorkspace && !workspaceMatchesRequestedIdentity(workspace, options)) {
      const diagnostics = userDefaultsDiagnostics(
        options,
        "Use the existing workspace, or run the explicit workspace create command to create another one.",
      );
      throw CLIError({
        code: "WORKSPACE_CREATE_CONFLICT",
        message: "The existing workspace does not match the requested workspace.",
        suggestion: diagnostics.suggestion,
        next: executableAction([
          "workspace",
          "create",
          ...workspaceCommandArgs(options),
          ...(options.workspaceCommandJson ? ["--json"] : []),
          "--name",
          options.workspaceName ?? "<name>",
          "--region",
          options.workspaceRegion ?? "<region>",
          ...organizationArgs(options),
          ...(options.folderId ? ["--folder-id", options.folderId] : []),
        ]),
        context: {
          existingWorkspace: workspaceIdentity(workspace),
          ...diagnostics.context,
        },
      });
    }

    if (interactive && !options.createWorkspace) {
      return chooseWorkspace(client, platformUrl, workspaces, options);
    }

    return useWorkspace(client, platformUrl, workspace, options);
  }

  if (workspaces.length > 1) {
    if (!interactive) {
      throw CLIError({
        code: "WORKSPACE_SELECTION_REQUIRED",
        message: "Multiple workspaces are available.",
        suggestion: "Choose one explicitly for non-interactive deployment.",
        next: executableAction(selectDeployArgs(options)),
        context: {
          workspaces: workspaces.map(workspaceIdentity),
        },
      });
    }

    return chooseWorkspace(client, platformUrl, workspaces, options);
  }

  throw internalError("Workspace discovery returned an invalid result");
}
