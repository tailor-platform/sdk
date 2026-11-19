import { type MessageInitShape } from "@bufbuild/protobuf";
import {
  type CreateApplicationRequestSchema,
  type DeleteApplicationRequestSchema,
  UpdateApplicationRequestSchema,
} from "@tailor-platform/tailor-proto/application_pb";
import {
  type Application as ProtoApplication,
  type Subgraph,
  Subgraph_ServiceType,
} from "@tailor-platform/tailor-proto/application_resource_pb";
import {
  type HttpAdapter,
  HttpAdapterSchema,
} from "@tailor-platform/tailor-proto/http_adapter_resource_pb";
import {
  fetchAllTolerant,
  getOrNull,
  listAuthIDPConfigsTolerant,
  resolveStaticWebsiteUrls,
  type OperatorClient,
} from "#/cli/shared/client";
import { CLIError, internalError } from "#/cli/shared/errors";
import { symbols } from "#/cli/shared/logger";
import { HTTP_METHODS } from "#/parser/service/http-adapter/index";
import { assertDefined } from "#/utils/assert";
import { createChangeSet } from "./change-set";
import {
  areNormalizedEqual,
  defineRequestComparison,
  isRequestUnchanged,
  toComparableProtoJson,
} from "./compare";
import { diffKeyed, labeledResourceChecks } from "./keyed-diff";
import {
  buildMetaRequest,
  isOwnedByApp,
  labelCountViolation,
  type MetadataLabelWrite,
  resourceTrn,
  withExtraLabels,
  writeMetadataLabelsDirect,
} from "./label";
import { createOwnershipTracker } from "./owned-resource";
import { expectedLocalStaticWebsiteNames } from "./staticwebsite";
import type { ApplyPhase, PlanContext } from "#/cli/commands/deploy/types";
import type { Application } from "#/cli/services/application";
import type { HttpAdapterBundleResult } from "#/cli/services/http-adapter/bundler";

/**
 * Apply application changes for the given phase.
 * @param client - Operator client instance
 * @param changeSet - Planned application changes
 * @param phase - Apply phase
 * @returns Applications whose labels the platform rejected for their count
 */
export async function applyApplication(
  client: OperatorClient,
  changeSet: Awaited<ReturnType<typeof planApplication>>,
  phase: Extract<ApplyPhase, "create-update" | "delete"> = "create-update",
): Promise<ApplicationLabelRejection[]> {
  if (phase === "create-update") {
    // Re-issue updateApplication for unchanged apps too, so the platform
    // re-composes the gateway schema synchronously on every deploy.
    const updates = [...changeSet.updates, ...changeSet.unchanged];
    const rejections = await Promise.all([
      ...changeSet.creates.map(async (create) => {
        create.request.cors = await resolveStaticWebsiteUrls(
          client,
          assertDefined(create.request.workspaceId, "request missing workspaceId"),
          create.request.cors,
          "CORS",
        );
        await client.createApplication(create.request);
        return writeApplicationLabels(client, create);
      }),
      ...updates.map(async (update) => {
        update.request.cors = await resolveStaticWebsiteUrls(
          client,
          assertDefined(update.request.workspaceId, "request missing workspaceId"),
          update.request.cors,
          "CORS",
        );
        await client.updateApplication(update.request);
        return writeApplicationLabels(client, update);
      }),
    ]);
    return rejections.filter((rejection) => rejection !== undefined);
  }
  // Delete in reverse order of dependencies
  // Applications
  await Promise.all(
    changeSet.deletes.map(async (del) => {
      await client.deleteApplication(del.request);
    }),
  );
  return [];
}

/** An application whose labels the platform rejected for their count. */
export type ApplicationLabelRejection = {
  name: string;
  /** The platform's violation message, which states its limit. */
  violation: string;
  /** Whether the SDK's own labels are stored, which keeps the application under SDK management. */
  sdkLabelsInPlace: boolean;
  /** `metadata` keys whose value is not stored. */
  unwrittenMetadata: string[];
  /** Stored label keys other than the SDK's own. */
  otherLabels: string[];
};

type ApplicationLabels = Pick<CreateApplication, "name" | "metaRequest" | "metadata">;

/**
 * Write an application's labels on their own rather than in a batch, so the
 * platform rejecting their count fails no other resource's labels. On that
 * rejection the SDK's own labels are written without `metadata`.
 * @param client - Operator client instance
 * @param entry - Application with its SDK labels and config `metadata`
 * @returns The rejection, or undefined when the labels were written
 */
async function writeApplicationLabels(
  client: OperatorClient,
  entry: ApplicationLabels,
): Promise<ApplicationLabelRejection | undefined> {
  const { name, metaRequest, metadata = {} } = entry;
  const violation = await labelCountViolationOf(() =>
    writeMetadataLabelsDirect(client, withExtraLabels(metaRequest, metadata)),
  );
  if (violation === undefined) return undefined;
  const sdkLabelsInPlace =
    Object.keys(metadata).length > 0 &&
    (await labelCountViolationOf(() => writeMetadataLabelsDirect(client, metaRequest))) ===
      undefined;
  const current = await getOrNull(() => client.getMetadata({ trn: metaRequest.trn }));
  const stored = current?.metadata?.labels ?? {};
  const sdkKeys = new Set(Object.keys(metaRequest.labels ?? {}));
  return {
    name,
    violation,
    sdkLabelsInPlace,
    unwrittenMetadata: Object.keys(metadata).filter((key) => stored[key] !== metadata[key]),
    otherLabels: Object.keys(stored)
      .filter((key) => !sdkKeys.has(key))
      .toSorted(),
  };
}

/**
 * Run a metadata write, turning the platform's label-count rejection into its violation message.
 * @param write - Metadata write to run
 * @returns The violation, or undefined when the write succeeded
 */
async function labelCountViolationOf(write: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await write();
    return undefined;
  } catch (error) {
    const violation = labelCountViolation(error);
    if (violation === undefined) throw error;
    return violation;
  }
}

/**
 * Build the failure for applications whose labels the platform rejected for
 * their count.
 * @param rejections - Rejected applications, as {@link applyApplication} returns them
 * @returns Error reporting every rejected application
 */
export function applicationLabelLimitError(
  rejections: ReadonlyArray<ApplicationLabelRejection>,
): CLIError {
  const howToDelete =
    "`tailor api GetMetadata` reads an application's labels and `tailor api SetMetadata` writes back the ones to keep";
  return CLIError({
    code: "DEPLOY_LABEL_LIMIT_EXCEEDED",
    message: rejections
      .map(
        ({ name, violation }) =>
          `The platform rejected the labels of application '${name}': ${violation}`,
      )
      .join("\n"),
    details: [
      ...rejections.map(describeLabelRejection),
      "Every other change of the deploy was applied.",
    ].join("\n"),
    suggestion: rejections.some(({ sdkLabelsInPlace }) => sdkLabelsInPlace)
      ? `Remove unwritten entries from 'metadata', or delete labels the application no longer needs, then deploy again; removing an entry already stored does not delete its label (${howToDelete}).`
      : `Delete labels the application no longer needs, then deploy again (${howToDelete}).`,
    context: {
      resourceType: "application",
      applications: rejections.map((rejection) => ({ ...rejection })),
    },
  });
}

function describeLabelRejection(rejection: ApplicationLabelRejection): string {
  const { name, sdkLabelsInPlace, unwrittenMetadata, otherLabels } = rejection;
  const outcome = sdkLabelsInPlace
    ? `the SDK's own labels are in place, but the 'metadata' entries ${unwrittenMetadata.join(", ")} were not written.`
    : "the SDK's own labels could not be written, because the labels already stored leave no room for them.";
  const stored = otherLabels.length > 0 ? ` Other labels stored: ${otherLabels.join(", ")}.` : "";
  return `Application '${name}': ${outcome}${stored}`;
}

/**
 * Re-issue the application update after an earlier apply in the same deploy,
 * so the gateway composes again with TailorDB settings that changed since.
 * @param client - Operator client instance
 * @param changeSet - Application changes already applied in this deploy
 */
export async function recomposeApplication(
  client: OperatorClient,
  changeSet: Awaited<ReturnType<typeof planApplication>>,
): Promise<void> {
  // planApplication builds a create and an update from the same request fields.
  const requests = [
    ...changeSet.creates.map(
      (entry) => entry.request as MessageInitShape<typeof UpdateApplicationRequestSchema>,
    ),
    ...[...changeSet.updates, ...changeSet.unchanged].map((entry) => entry.request),
  ];
  await Promise.all(requests.map((request) => client.updateApplication(request)));
}

type CreateApplication = {
  name: string;
  request: MessageInitShape<typeof CreateApplicationRequestSchema>;
  metaRequest: MetadataLabelWrite;
  /** Labels from the config's `metadata`, left out when the platform rejects the label count. */
  metadata?: Record<string, string>;
  /** Per-adapter diff lines shown indented beneath the application entry. */
  details?: string[];
};

type UpdateApplication = {
  name: string;
  request: MessageInitShape<typeof UpdateApplicationRequestSchema>;
  metaRequest: MetadataLabelWrite;
  /** Labels from the config's `metadata`, left out when the platform rejects the label count. */
  metadata?: Record<string, string>;
  /** Per-adapter diff lines shown indented beneath the application entry. */
  details?: string[];
};

type DeleteApplication = {
  name: string;
  request: MessageInitShape<typeof DeleteApplicationRequestSchema>;
};

type DesiredApplication = {
  name: string;
  request: MessageInitShape<typeof CreateApplicationRequestSchema> &
    MessageInitShape<typeof UpdateApplicationRequestSchema>;
  /** The request with its `:url` CORS entries resolved as the plan resolves them. */
  comparableRequest: MessageInitShape<typeof UpdateApplicationRequestSchema>;
  metaRequest: MetadataLabelWrite;
  metadata?: Record<string, string>;
};

function normalizeHttpAdapter(adapter: HttpAdapter): void {
  adapter.methods.sort();
  // The platform stamps these times.
  adapter.createTime = undefined;
  adapter.updateTime = undefined;
}

const applicationComparison = defineRequestComparison({
  schema: UpdateApplicationRequestSchema,
  excluded: ["workspaceId", "applicationName", "updateMask"],
  normalize: (request) => {
    request.cors.sort();
    request.allowedIpAddresses.sort();
    request.subgraphs.sort(
      (left, right) =>
        left.serviceType - right.serviceType ||
        left.serviceNamespace.localeCompare(right.serviceNamespace),
    );
    request.httpAdapters.forEach(normalizeHttpAdapter);
    request.httpAdapters.sort((left, right) => left.name.localeCompare(right.name));
  },
});

/**
 * Plan application changes based on current and desired state.
 * @param context - Planning context
 * @param httpAdapterBuildResult - Bundled HTTP adapter scripts to embed on the Application
 * @param previous - A prior call's fetched existing applications/labels, reused instead of
 *   re-querying the platform (the application resource itself isn't touched between a deploy's
 *   first plan and its conditional rebuild's replan)
 * @param previous.existingApplications - The prior call's fetched application list
 * @param previous.existingLabels - The prior call's fetched labels for this application
 * @returns Planned changes
 */
export async function planApplication(
  context: PlanContext,
  httpAdapterBuildResult?: HttpAdapterBundleResult,
  previous?: {
    existingApplications: ReadonlyArray<ProtoApplication>;
    existingLabels: Record<string, string> | undefined;
  },
) {
  const { client, workspaceId, application, forRemoval } = context;
  const ownership = createOwnershipTracker(application.name, application.id);
  const changeSet = createChangeSet<
    CreateApplication,
    UpdateApplication,
    DeleteApplication,
    never,
    UpdateApplication
  >("Applications");

  // The application resource itself isn't touched between a deploy's first
  // plan and its conditional rebuild's replan (only the prerequisite resource
  // kinds are applied in between), so its own list/label fetches are reused
  // when available. `cors` is the exception: it's re-resolved live, right
  // below, since the site it may reference could have just been created.
  const existingApplications =
    previous?.existingApplications ??
    (await fetchAllTolerant(async (pageToken, maxPageSize) => {
      const { applications, nextPageToken } = await client.listApplications({
        workspaceId,
        pageToken,
        pageSize: maxPageSize,
      });
      return [applications, nextPageToken];
    }));

  const ownedByConfig = (labels: Record<string, string> | undefined) =>
    isOwnedByApp(labels, application.name, application.id);
  const scheduleOwnedAppDeletes = async (
    candidates: ReadonlyArray<ProtoApplication>,
    owns: (labels: Record<string, string> | undefined) => boolean,
  ) => {
    const owned = await Promise.all(
      candidates.map(async (app) =>
        owns(await fetchAppLabels(client, workspaceId, app.name)) ? app.name : null,
      ),
    );
    for (const name of owned) {
      if (name) {
        changeSet.deletes.push({
          name,
          request: {
            workspaceId,
            applicationName: name,
          },
        });
      }
    }
  };

  // The platform rejects an application without subgraphs, so a config with
  // none (e.g. only static web hosting) is planned like a removal.
  if (forRemoval || application.subgraphs.length === 0) {
    // A same-named app in a shared workspace may belong to another user, so
    // never delete by name alone. Without an id only the same-name app can be
    // ours; with an id, scan all apps to also clean up renamed-away ones.
    const candidates = application.id
      ? existingApplications
      : existingApplications.filter((app) => app.name === application.name);
    // A deploy must not record other apps as owners: that blocks renamed-app cleanup.
    await scheduleOwnedAppDeletes(candidates, (labels) =>
      forRemoval ? ownership.ownsRemaining(labels) : ownedByConfig(labels),
    );
    return Object.assign(changeSet, ownership.result, {
      existingApplications,
      existingLabels: undefined,
    });
  }

  let authNamespace: string | undefined;
  let authIdpConfigName: string | undefined;
  if (application.authService) {
    authNamespace = application.authService.config.name;

    const idProvider = application.authService.config.idProvider;
    if (idProvider) {
      authIdpConfigName = idProvider.name;
    }
  } else if (application.config.auth) {
    // Prefer peer plans for same-run multi-config deploys; otherwise read remote state.
    authNamespace = application.config.auth.name;
    if (context.externalAuthIdpConfigNames?.has(authNamespace)) {
      authIdpConfigName = context.externalAuthIdpConfigNames.get(authNamespace);
    } else {
      const idpConfigs = await listAuthIDPConfigsTolerant(client, workspaceId, authNamespace);
      if (idpConfigs.length > 0) {
        const [firstConfig] = idpConfigs;
        if (firstConfig) {
          authIdpConfigName = firstConfig.name;
        }
      }
    }
  }
  const metaRequest = await buildMetaRequest({
    trn: resourceTrn(workspaceId, "application", application.name),
    appName: application.name,
    appId: application.id,
  });
  const { metadata } = application.config;
  // `previous.existingLabels` can legitimately be `undefined` (no metadata
  // found on the first fetch), so branch on `previous` itself -- `??` would
  // treat that cached `undefined` as a cache miss and re-fetch needlessly.
  const existingLabels = previous
    ? previous.existingLabels
    : await fetchAppLabels(client, workspaceId, application.name);
  const metadataDetails = diffMetadataDisplay(existingLabels, metadata);
  const expectedLocalWebsites = expectedLocalStaticWebsiteNames(context);
  const resolvedCors = await resolveStaticWebsiteUrls(
    client,
    workspaceId,
    application.config.cors,
    "CORS",
    { expectedLocalNames: expectedLocalWebsites },
  );
  const httpAdapters = buildHttpAdapters(application, httpAdapterBuildResult);
  const request = {
    workspaceId,
    applicationName: application.name,
    authNamespace,
    authIdpConfigName,
    cors: application.config.cors,
    subgraphs: application.subgraphs.map((subgraph) => protoSubgraph(subgraph)),
    allowedIpAddresses: application.config.allowedIpAddresses,
    disableIntrospection: application.config.disableIntrospection,
    httpAdapters,
  };
  const existing = existingApplications.find((app) => app.name === application.name);

  // Detect renames: other apps owned by our id should be deleted before
  // creating/updating the current name (so the old name is freed up).
  if (application.id) {
    await scheduleOwnedAppDeletes(
      existingApplications.filter((app) => app.name !== application.name),
      ownedByConfig,
    );
  }

  const nonEmpty = (lines: string[]) => (lines.length > 0 ? lines : undefined);
  await diffKeyed({
    changeSet,
    desired: [
      {
        name: application.name,
        request,
        comparableRequest: { ...request, cors: resolvedCors },
        metaRequest,
        metadata,
      },
    ],
    existing: existing
      ? [[existing.name, { resource: existing, allLabels: existingLabels }] as const]
      : [],
    keyOf: (app) => app.name,
    ...labeledResourceChecks(ownership, (app: DesiredApplication) => ({
      resourceType: "application",
      resourceName: app.name,
    })),
    isConfigUnchanged: (app, { resource }) =>
      metadataDetails.length === 0 &&
      isRequestUnchanged(applicationComparison, app.comparableRequest, resource),
    create: ({ name, request, metaRequest, metadata }) => ({
      name,
      request,
      metaRequest,
      metadata,
      details: nonEmpty([...diffHttpAdapterDisplay(undefined, httpAdapters), ...metadataDetails]),
    }),
    update: ({ name, request, metaRequest, metadata }, { resource }) => {
      const details = nonEmpty([
        ...diffHttpAdapterDisplay(resource.httpAdapters, httpAdapters),
        ...metadataDetails,
      ]);
      return { name, request, metaRequest, metadata, ...(details && { details }) };
    },
    // Plan display shows this as unchanged, but apply still re-issues it.
    unchanged: ({ name, request, metaRequest, metadata }) => ({
      name,
      request,
      metaRequest,
      metadata,
    }),
    // Other applications are deleted only by the rename and removal paths above.
    delete: () => undefined,
  });

  return Object.assign(changeSet, ownership.result, {
    existingApplications,
    existingLabels,
  });
}

async function fetchAppLabels(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
): Promise<Record<string, string> | undefined> {
  const response = await getOrNull(async () => {
    const { metadata } = await client.getMetadata({
      trn: resourceTrn(workspaceId, "application", appName),
    });
    return metadata;
  });
  return response?.labels;
}

/**
 * Build per-adapter diff lines for the application plan display. The platform
 * models HTTP adapters as an embedded Application field (no dedicated RPC), so
 * adapter changes surface as an Application update; these lines show which
 * adapter actually changed instead of just `~ <app>`.
 * @param existingAdapters - HTTP adapters currently deployed on the application
 * @param desiredAdapters - HTTP adapters built from the local config
 * @returns Indented diff lines (`+`/`~`/`-` per adapter), sorted by name
 */
export function diffHttpAdapterDisplay(
  existingAdapters: ReadonlyArray<MessageInitShape<typeof HttpAdapterSchema>> | undefined,
  desiredAdapters: ReadonlyArray<MessageInitShape<typeof HttpAdapterSchema>>,
): string[] {
  const existingByName = new Map((existingAdapters ?? []).map((a) => [a.name ?? "", a]));
  const desiredByName = new Map(desiredAdapters.map((a) => [a.name ?? "", a]));
  const entries: Array<{ name: string; symbol: string }> = [];
  for (const [name, desired] of desiredByName) {
    const existing = existingByName.get(name);
    if (!existing) {
      entries.push({ name, symbol: symbols.create });
    } else if (
      !areNormalizedEqual(
        toComparableProtoJson(HttpAdapterSchema, existing, normalizeHttpAdapter),
        toComparableProtoJson(HttpAdapterSchema, desired, normalizeHttpAdapter),
      )
    ) {
      entries.push({ name, symbol: symbols.update });
    }
  }
  for (const name of existingByName.keys()) {
    if (!desiredByName.has(name)) {
      entries.push({ name, symbol: symbols.delete });
    }
  }
  return entries
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .map((entry) => `${entry.symbol} ${entry.name} (httpAdapter)`);
}

/**
 * Build per-entry diff lines for the config's `metadata` labels. Labels the
 * config does not name are kept as they are, so they never appear here.
 * @param existingLabels - Labels currently stored on the application
 * @param metadata - `metadata` entries from the local config
 * @returns Indented diff lines (`+`/`~` per entry), sorted by key
 */
function diffMetadataDisplay(
  existingLabels: Record<string, string> | undefined,
  metadata: Record<string, string> | undefined,
): string[] {
  const existing = existingLabels ?? {};
  const isStored = (key: string) => Object.hasOwn(existing, key);
  return Object.entries(metadata ?? {})
    .filter(([key, value]) => !isStored(key) || existing[key] !== value)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key]) => `${isStored(key) ? symbols.update : symbols.create} ${key} (metadata)`);
}

function buildHttpAdapters(
  application: Readonly<Application>,
  httpAdapterBuildResult: HttpAdapterBundleResult | undefined,
): MessageInitShape<typeof HttpAdapterSchema>[] {
  const adapters = application.httpAdapterService?.adapters ?? [];
  if (adapters.length === 0) {
    return [];
  }
  return adapters.map((loaded) => {
    const inputScript = httpAdapterBuildResult?.bundledInputs.get(loaded.adapter.name);
    if (!inputScript) {
      throw internalError(
        `HTTP adapter "${loaded.adapter.name}" was loaded but no bundled input script is available`,
      );
    }
    let outputScript = "";
    if (loaded.hasOutput) {
      const bundled = httpAdapterBuildResult?.bundledOutputs.get(loaded.adapter.name);
      if (!bundled) {
        throw internalError(
          `HTTP adapter "${loaded.adapter.name}" declares an output handler but no bundled output script is available`,
        );
      }
      outputScript = bundled;
    }
    return {
      name: loaded.adapter.name,
      pathPattern: loaded.adapter.pathPattern,
      methods: loaded.methods.map((m) => HTTP_METHODS[m]),
      inputScript,
      outputScript,
      // `enabled`/`priority` are always populated here because
      // HttpAdapterConfigSchema applies their defaults during parse.
      enabled: loaded.adapter.enabled,
      priority: loaded.adapter.priority,
    };
  });
}

/**
 * Convert a config subgraph to the subgraph the Platform records for an application.
 * @param subgraph - Subgraph from the application's config
 * @returns The subgraph's service type and namespace
 */
export function protoSubgraph(
  subgraph: Readonly<{ Type: string; Name: string }>,
): Pick<Subgraph, "serviceType" | "serviceNamespace"> {
  // TODO(remiposo): Make it type-safe
  let serviceType: Subgraph_ServiceType;
  switch (subgraph.Type) {
    case "tailordb":
      serviceType = Subgraph_ServiceType.TAILORDB;
      break;
    case "pipeline":
      serviceType = Subgraph_ServiceType.PIPELINE;
      break;
    case "idp":
      serviceType = Subgraph_ServiceType.IDP;
      break;
    case "auth":
      serviceType = Subgraph_ServiceType.AUTH;
      break;
    default:
      throw internalError(`Unknown subgraph type: ${subgraph.Type}`);
  }
  return {
    serviceType,
    serviceNamespace: subgraph.Name,
  };
}
