import { type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  type CreateStaticWebsiteRequestSchema,
  type DeleteStaticWebsiteRequestSchema,
  type UpdateStaticWebsiteRequestSchema,
} from "@tailor-proto/tailor/v1/staticwebsite_pb";
import { type Application } from "@/cli/application";
import { type ApplyPhase } from "..";
import { fetchAll, type OperatorClient } from "../../client";
import { metaRequest, sdkNameLabelKey, type WithLabel } from "./label";
import { ChangeSet } from ".";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

export async function applyStaticWebsite(
  client: OperatorClient,
  changeSet: Awaited<ReturnType<typeof planStaticWebsite>>,
  phase: ApplyPhase = "create-update",
) {
  if (phase === "create-update") {
    // StaticWebsites
    await Promise.all([
      ...changeSet.creates.map(async (create) => {
        await client.createStaticWebsite(create.request);
        await client.setMetadata(create.metaRequest);
      }),
      ...changeSet.updates.map(async (update) => {
        await client.updateStaticWebsite(update.request);
        await client.setMetadata(update.metaRequest);
      }),
    ]);
  } else if (phase === "delete") {
    // Delete in reverse order of dependencies
    // StaticWebsites
    await Promise.all(
      changeSet.deletes.map((del) => client.deleteStaticWebsite(del.request)),
    );
  }
}

type CreateStaticWebsite = {
  name: string;
  request: MessageInitShape<typeof CreateStaticWebsiteRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type UpdateStaticWebsite = {
  name: string;
  request: MessageInitShape<typeof UpdateStaticWebsiteRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type DeleteStaticWebsite = {
  name: string;
  request: MessageInitShape<typeof DeleteStaticWebsiteRequestSchema>;
};

function trn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:staticwebsite:${name}`;
}

export async function planStaticWebsite(
  client: OperatorClient,
  workspaceId: string,
  application: Readonly<Application>,
) {
  const changeSet: ChangeSet<
    CreateStaticWebsite,
    UpdateStaticWebsite,
    DeleteStaticWebsite
  > = new ChangeSet("StaticWebsites");

  // Fetch existing static websites
  const withoutLabel = await fetchAll(async (pageToken) => {
    try {
      const { staticwebsites, nextPageToken } = await client.listStaticWebsites(
        {
          workspaceId,
          pageToken,
        },
      );
      return [staticwebsites, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });
  const existingWebsites: WithLabel<(typeof withoutLabel)[number]> = {};
  await Promise.all(
    withoutLabel.map(async (resource) => {
      const { metadata } = await client.getMetadata({
        trn: trn(workspaceId, resource.name),
      });
      existingWebsites[resource.name] = {
        resource,
        label: metadata?.labels[sdkNameLabelKey],
      };
    }),
  );

  for (const websiteService of application.staticWebsiteServices) {
    const config = websiteService;
    const name = websiteService.name;
    const existing = existingWebsites[name];

    if (existing) {
      // Check if managed by another application
      if (existing.label && existing.label !== application.name) {
        throw new Error(
          `StaticWebsite "${name}" already exists and is managed by another application "${existing.label}"`,
        );
      }
      // For backward compatibility and idempotency, update even when labels don't exist
      changeSet.updates.push({
        name,
        request: {
          workspaceId,
          staticwebsite: {
            name,
            description: config.description || "",
            allowedIpAddresses: config.allowedIpAddresses || [],
          },
        },
        metaRequest: metaRequest(trn(workspaceId, name), application.name),
      });
      delete existingWebsites[name];
    } else {
      changeSet.creates.push({
        name,
        request: {
          workspaceId,
          staticwebsite: {
            name,
            description: config.description || "",
            allowedIpAddresses: config.allowedIpAddresses || [],
          },
        },
        metaRequest: metaRequest(trn(workspaceId, name), application.name),
      });
    }
  }
  Object.entries(existingWebsites).forEach(([name]) => {
    // Only delete websites managed by this application
    if (existingWebsites[name]?.label === application.name) {
      changeSet.deletes.push({
        name,
        request: {
          workspaceId,
          name,
        },
      });
    }
  });

  changeSet.print();
  return changeSet;
}
