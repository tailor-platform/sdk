import { arg } from "politty";
import { z } from "zod";
import { positiveIntArg } from "@/cli/shared/args";
import { fetchAll, initOperatorClient, type OperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { listOrganizations } from "./list";
import type { UserOrganizationInfo } from "./transform";

interface TreeNode {
  name: string;
  children: TreeNode[];
}

export interface OrganizationTreeOptions {
  organizationId?: string;
  depth?: number;
}

interface OrganizationTreeJson {
  organizationId: string;
  organizationName: string;
  folders: FolderTreeJson[];
}

interface FolderTreeJson {
  id: string;
  name: string;
  children: FolderTreeJson[];
}

async function fetchChildFolders(
  client: OperatorClient,
  organizationId: string,
  parentFolderId: string,
  currentDepth: number,
  maxDepth: number | undefined,
): Promise<TreeNode[]> {
  if (maxDepth !== undefined && currentDepth >= maxDepth) {
    return [];
  }

  const folders = await fetchAll(async (pageToken, maxPageSize) => {
    const response = await client.listOrganizationFolders({
      organizationId,
      parentFolderId,
      pageToken,
      pageSize: maxPageSize,
    });
    return [response.folders, response.nextPageToken];
  });

  const nodes: TreeNode[] = [];
  for (const folder of folders) {
    const children = folder.hasChildren
      ? await fetchChildFolders(client, organizationId, folder.id, currentDepth + 1, maxDepth)
      : [];
    nodes.push({ name: folder.name, children });
  }
  return nodes;
}

async function buildFolderTreeJson(
  client: OperatorClient,
  organizationId: string,
  parentFolderId: string,
  currentDepth: number,
  maxDepth: number | undefined,
): Promise<FolderTreeJson[]> {
  if (maxDepth !== undefined && currentDepth >= maxDepth) {
    return [];
  }

  const folders = await fetchAll(async (pageToken, maxPageSize) => {
    const response = await client.listOrganizationFolders({
      organizationId,
      parentFolderId,
      pageToken,
      pageSize: maxPageSize,
    });
    return [response.folders, response.nextPageToken];
  });

  const result: FolderTreeJson[] = [];
  for (const folder of folders) {
    const children = folder.hasChildren
      ? await buildFolderTreeJson(client, organizationId, folder.id, currentDepth + 1, maxDepth)
      : [];
    result.push({ id: folder.id, name: folder.name, children });
  }
  return result;
}

function renderTree(nodes: TreeNode[], prefix: string): string {
  let output = "";
  for (let i = 0; i < nodes.length; i++) {
    const isLast = i === nodes.length - 1;
    const connector = isLast ? "\u2514\u2500\u2500 " : "\u251c\u2500\u2500 ";
    const childPrefix = isLast ? "    " : "\u2502   ";
    output += `${prefix}${connector}${nodes[i].name}\n`;
    if (nodes[i].children.length > 0) {
      output += renderTree(nodes[i].children, prefix + childPrefix);
    }
  }
  return output;
}

async function buildOrgTree(
  client: OperatorClient,
  org: UserOrganizationInfo,
  depth: number | undefined,
): Promise<string> {
  const children = await fetchChildFolders(client, org.organizationId, org.rootFolderId, 0, depth);
  let output = `${org.organizationName}\n`;
  output += renderTree(children, "");
  return output;
}

/**
 * Display a tree view of organizations and their folder hierarchy.
 * @param options - Tree display options
 * @returns Organization tree as structured data
 */
export async function organizationTree(
  options?: OrganizationTreeOptions,
): Promise<OrganizationTreeJson[]> {
  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  let orgs: UserOrganizationInfo[];
  if (options?.organizationId) {
    orgs = (await listOrganizations()).filter((o) => o.organizationId === options.organizationId);
    if (orgs.length === 0) {
      throw new Error(`Organization "${options.organizationId}" not found.`);
    }
  } else {
    orgs = await listOrganizations();
  }

  const depth = options?.depth;

  const jsonResult: OrganizationTreeJson[] = [];
  for (const org of orgs) {
    const folders = await buildFolderTreeJson(
      client,
      org.organizationId,
      org.rootFolderId,
      0,
      depth,
    );
    jsonResult.push({
      organizationId: org.organizationId,
      organizationName: org.organizationName,
      folders,
    });
  }

  return jsonResult;
}

export const treeCommand = defineAppCommand({
  name: "tree",
  description: "Display organization folder hierarchy as a tree.",
  args: z
    .object({
      "organization-id": arg(z.string().optional(), {
        alias: "o",
        description: "Organization ID (show all if omitted)",
        env: "TAILOR_PLATFORM_ORGANIZATION_ID",
      }),
      depth: arg(positiveIntArg.optional(), {
        alias: "d",
        description: "Maximum folder depth to display",
      }),
    })
    .strict(),
  run: async (args) => {
    const accessToken = await loadAccessToken();
    const client = await initOperatorClient(accessToken);

    let orgs: UserOrganizationInfo[];
    if (args["organization-id"]) {
      orgs = (await listOrganizations()).filter(
        (o) => o.organizationId === args["organization-id"],
      );
      if (orgs.length === 0) {
        throw new Error(`Organization "${args["organization-id"]}" not found.`);
      }
    } else {
      orgs = await listOrganizations();
    }

    if (args.json) {
      const jsonResult: OrganizationTreeJson[] = [];
      for (const org of orgs) {
        const folders = await buildFolderTreeJson(
          client,
          org.organizationId,
          org.rootFolderId,
          0,
          args.depth,
        );
        jsonResult.push({
          organizationId: org.organizationId,
          organizationName: org.organizationName,
          folders,
        });
      }
      logger.out(jsonResult);
      return;
    }

    const trees: string[] = [];
    for (const org of orgs) {
      trees.push(await buildOrgTree(client, org, args.depth));
    }

    logger.log(trees.join("\n"));
  },
});
