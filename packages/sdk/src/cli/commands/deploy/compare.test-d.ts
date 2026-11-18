import { UpdateAIGatewayRequestSchema } from "@tailor-platform/tailor-proto/aigateway_pb";
import { UpdateIdPServiceRequestSchema } from "@tailor-platform/tailor-proto/idp_pb";
import { assertType, describe, test } from "vitest";
import { defineRequestComparison, isRequestUnchanged } from "./compare";
import type { AIGateway } from "@tailor-platform/tailor-proto/aigateway_resource_pb";
import type { IdPService } from "@tailor-platform/tailor-proto/idp_resource_pb";

declare const idpService: IdPService;
declare const aiGateway: AIGateway;

const idpComparison = defineRequestComparison({
  schema: UpdateIdPServiceRequestSchema,
  excluded: ["workspaceId", "namespaceName"],
});

describe("isRequestUnchanged", () => {
  test("accepts an existing resource that has every compared request member", () => {
    assertType<boolean>(isRequestUnchanged(idpComparison, {}, idpService));
    assertType<boolean>(
      isRequestUnchanged(
        defineRequestComparison({
          schema: UpdateAIGatewayRequestSchema,
          excluded: ["workspaceId", "aigatewayName", "updateMask", "disabled"],
        }),
        {},
        aiGateway,
      ),
    );
  });

  test("rejects an existing resource that lacks a compared request member", () => {
    const { permission: _permission, ...withoutPermission } = idpService;
    // @ts-expect-error `permission` is compared but the existing resource has no such member
    assertType<boolean>(isRequestUnchanged(idpComparison, {}, withoutPermission));
    assertType<boolean>(
      isRequestUnchanged(
        defineRequestComparison({
          schema: UpdateAIGatewayRequestSchema,
          excluded: ["workspaceId", "aigatewayName"],
        }),
        {},
        // @ts-expect-error `updateMask` is compared unless excluded, and AIGateway has no such member
        aiGateway,
      ),
    );
  });

  test("rejects an excluded name that is not a request member", () => {
    assertType(
      defineRequestComparison({
        schema: UpdateIdPServiceRequestSchema,
        // @ts-expect-error `namespace` is the resource's member, not the request's
        excluded: ["workspaceId", "namespace"],
      }),
    );
  });
});
