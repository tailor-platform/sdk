import { type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import {
  type CreateStaticWebsiteRequestSchema,
  type DeleteStaticWebsiteRequestSchema,
  type UpdateStaticWebsiteRequestSchema,
} from "@tailor-proto/tailor/v1/staticwebsite_pb";
import { type Application } from "@/cli/application";
import { ChangeSet } from ".";
import { type ApplyPhase } from "..";
import { fetchAll, type OperatorClient } from "../client";

export async function applyStaticWebsite(
  client: OperatorClient,
  changeSet: Awaited<ReturnType<typeof planStaticWebsite>>,
  phase: ApplyPhase = "create-update",
) {
  if (phase === "create-update") {
    // StaticWebsites
    for (const create of changeSet.creates) {
      await client.createStaticWebsite(create.request);
    }
    for (const update of changeSet.updates) {
      await client.updateStaticWebsite(update.request);
    }
  } else if (phase === "delete") {
    // Delete in reverse order of dependencies
    // StaticWebsites
    for (const del of changeSet.deletes) {
      await client.deleteStaticWebsite(del.request);
    }
  }
}

type CreateStaticWebsite = {
  name: string;
  request: MessageInitShape<typeof CreateStaticWebsiteRequestSchema>;
};

type UpdateStaticWebsite = {
  name: string;
  request: MessageInitShape<typeof UpdateStaticWebsiteRequestSchema>;
};

type DeleteStaticWebsite = {
  name: string;
  request: MessageInitShape<typeof DeleteStaticWebsiteRequestSchema>;
};

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
  const existingWebsites = await fetchAll(async (pageToken) => {
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

  const existingNameSet = new Set<string>();
  existingWebsites.forEach((website) => {
    existingNameSet.add(website.name);
  });

  for (const websiteService of application.staticWebsiteServices) {
    const config = websiteService;
    const name = websiteService.name;

    if (existingNameSet.has(name)) {
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
      });
      existingNameSet.delete(name);
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
      });
    }
  }

  existingNameSet.forEach((name) => {
    changeSet.deletes.push({
      name,
      request: {
        workspaceId,
        name,
      },
    });
  });

  changeSet.print();
  return changeSet;
}
