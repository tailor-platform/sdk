import { create } from "@bufbuild/protobuf";
import { GetMetadataResponseSchema } from "@tailor-platform/tailor-proto/metadata_pb";
import { fetchAllTolerant, type OperatorClient } from "#/cli/shared/client";
import { sdkAppIdLabelKey, sdkAppIdLabelValue, sdkNameLabelKey } from "./label";
import type { Metadata } from "@tailor-platform/tailor-proto/metadata_resource_pb";

interface MetadataLookupApplication {
  name: string;
  id?: string;
}

interface CreateMetadataLookupClientParams {
  client: OperatorClient;
  workspaceId: string;
  applications: ReadonlyArray<MetadataLookupApplication>;
}

function ownershipFilters(
  applications: ReadonlyArray<MetadataLookupApplication>,
): Record<string, string>[] {
  const filters = new Map<string, Record<string, string>>();
  for (const application of applications) {
    filters.set(`${sdkNameLabelKey}\0${application.name}`, {
      [sdkNameLabelKey]: application.name,
    });
    if (application.id) {
      const value = sdkAppIdLabelValue(application.id);
      filters.set(`${sdkAppIdLabelKey}\0${value}`, { [sdkAppIdLabelKey]: value });
    }
  }
  return [...filters.values()];
}

/**
 * Create a client that resolves metadata from app-scoped list queries first.
 * List misses still delegate to `GetMetadata` because an exact label filter
 * cannot distinguish another owner from a resource with no SDK labels.
 * @param params - Metadata lookup inputs
 * @param params.client - Operator client instance
 * @param params.workspaceId - Target workspace ID
 * @param params.applications - Applications taking part in the deploy
 * @returns Operator client with cached metadata reads
 */
export async function createMetadataLookupClient(
  params: CreateMetadataLookupClientParams,
): Promise<OperatorClient> {
  const { client, workspaceId, applications } = params;
  const pages = await Promise.all(
    ownershipFilters(applications).map((labels) =>
      fetchAllTolerant(async (pageToken, maxPageSize) => {
        const { results, nextPageToken } = await client.listMetadata({
          workspaceId,
          labels,
          pageToken,
          pageSize: maxPageSize,
        });
        return [results, nextPageToken];
      }),
    ),
  );
  const metadataByTrn = new Map<string, Metadata>();
  for (const result of pages.flat()) {
    if (result.metadata) metadataByTrn.set(result.trn, result.metadata);
  }

  const fallbackByTrn = new Map<string, ReturnType<OperatorClient["getMetadata"]>>();
  const getMetadata: OperatorClient["getMetadata"] = (request, options) => {
    const metadata = metadataByTrn.get(request.trn ?? "");
    if (metadata) {
      return Promise.resolve(create(GetMetadataResponseSchema, { metadata }));
    }
    const trn = request.trn ?? "";
    let fallback = fallbackByTrn.get(trn);
    if (!fallback) {
      fallback = client.getMetadata(request, options);
      fallbackByTrn.set(trn, fallback);
    }
    return fallback;
  };

  return new Proxy(client, {
    get(target, property, receiver) {
      return property === "getMetadata" ? getMetadata : Reflect.get(target, property, receiver);
    },
  });
}
