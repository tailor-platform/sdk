import { describe, expect, test } from "vitest";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { planAIGateway } from "./aigateway";
import type { Application } from "#/cli/services/application";
import type { PlanContext } from "./types";

const legacyLabels = {
  "sdk-name": "shop",
  "sdk-app-id": "app-11111111-1111-4111-8111-111111111111",
  "sdk-version": "v1-0-0",
};

function workspaceContext(): PlanContext {
  const gateway = { name: "gw", authNamespace: "auth", cors: [] };
  return {
    client: mockOperatorClient({
      listAIGateways: {
        aigateways: [gateway, { ...gateway, name: "old" }],
        nextPageToken: "",
      },
      getMetadata: { metadata: { labels: legacyLabels } },
    }),
    workspaceId: "ws",
    application: {
      aiGatewayServices: [gateway],
      staticWebsiteServices: [],
    } as unknown as Application,
    owner: { kind: "workspace" },
    forRemoval: false,
    config: { path: "/proj/tailor.config.ts" } as PlanContext["config"],
  };
}

describe("planning for a workspace config", () => {
  test("takes over a resource an application deployed and deletes one the config no longer has", async () => {
    const result = await planAIGateway(workspaceContext());

    expect(result.changeSet.updates).toEqual([
      expect.objectContaining({
        name: "gw",
        metaRequest: {
          trn: "trn:v1:workspace:ws:aigateway:gw",
          labels: { "sdk-managed": "workspace", "sdk-version": expect.any(String) },
          remove: ["sdk-name", "sdk-app-id"],
          removePrefixes: ["sdk-depended-by-app-", "sdk-job-depended-by-app-", "sdk-on-app-"],
        },
      }),
    ]);
    expect(result.changeSet.updates[0]).not.toHaveProperty("forcedBySdkVersion");
    expect(result.changeSet.deletes.map(({ name }) => name)).toEqual(["old"]);
    expect(result.takeovers).toEqual([
      expect.objectContaining({ resourceName: "gw", action: "update", currentOwner: "shop" }),
      expect.objectContaining({ resourceName: "old", action: "delete", currentOwner: "shop" }),
    ]);
  });
});
