import { create } from "@bufbuild/protobuf";
import { UpdateAIGatewayRequestSchema } from "@tailor-platform/tailor-proto/aigateway_pb";
import { AIGatewaySchema } from "@tailor-platform/tailor-proto/aigateway_resource_pb";
import {
  IdPPermissionPermit,
  IdPPermissionSchema,
} from "@tailor-platform/tailor-proto/idp_resource_pb";
import { TailorDBTypeSchema } from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import { describe, expect, test } from "vitest";
import {
  areNormalizedEqual,
  defineRequestComparison,
  emptyMessageAsUnset,
  isRequestUnchanged,
  normalizeProtoConfig,
  stableStringify,
  toComparableProtoJson,
} from "./compare";

describe("compare policy", () => {
  // Generic compare preserves type distinctions.
  // Proto-specific representation gaps such as bigint vs number should be normalized
  // by each resource before reaching this helper.
  test("preserves bigint as distinct from number", () => {
    expect(stableStringify(1n)).toBe('"1"');
    expect(stableStringify(1)).toBe("1");
    expect(areNormalizedEqual({ seconds: 1n }, { seconds: 1 })).toBe(false);
  });

  test("normalizeProtoConfig keeps bigint-backed values as strings after round-trip", () => {
    expect(normalizeProtoConfig({ seconds: 1n })).toEqual({ seconds: "1" });
    expect(normalizeProtoConfig({ seconds: 1 })).toEqual({ seconds: 1 });
  });

  test("toComparableProtoJson equates an init shape with its materialized message", () => {
    const init = {
      name: "Invoice",
      schema: { fields: { code: { type: "string", required: true } } },
    };
    // Deserialized messages materialize implicit proto3 fields (e.g. bools
    // added to the proto later) with zero values that the init shape omits.
    // optionalOnCreate is deliberately named as the canary: it is a field the
    // SDK never sets, so it proves materialization happens.
    const materialized = create(TailorDBTypeSchema, init);
    expect(materialized.schema?.fields.code?.optionalOnCreate).toBe(false);

    expect(
      areNormalizedEqual(
        toComparableProtoJson(TailorDBTypeSchema, init),
        toComparableProtoJson(TailorDBTypeSchema, materialized),
      ),
    ).toBe(true);
  });

  test("toComparableProtoJson normalizes a copy, leaving the input message intact", () => {
    const remote = create(UpdateAIGatewayRequestSchema, { cors: ["https://b", "https://a"] });

    const canonical = toComparableProtoJson(UpdateAIGatewayRequestSchema, remote, (request) => {
      request.cors.sort();
    });

    expect(canonical).toEqual({ cors: ["https://a", "https://b"] });
    expect(remote.cors).toEqual(["https://b", "https://a"]);
  });
});

describe("isRequestUnchanged", () => {
  const comparison = defineRequestComparison({
    schema: UpdateAIGatewayRequestSchema,
    excluded: ["workspaceId", "aigatewayName", "updateMask", "disabled"],
    normalize: (request) => {
      request.cors.sort();
    },
  });
  const sent = {
    workspaceId: "workspace",
    aigatewayName: "gateway",
    authNamespace: "auth",
    cors: ["https://b", "https://a"],
  };
  const existing = create(AIGatewaySchema, {
    name: "gateway",
    domain: "gateway.example.com",
    url: "https://gateway.example.com",
    authNamespace: "auth",
    cors: ["https://a", "https://b"],
    disabled: true,
  });

  test("ignores excluded members and existing members the request does not have", () => {
    expect(isRequestUnchanged(comparison, sent, existing)).toBe(true);
  });

  test.each([
    { member: "authNamespace", changed: { authNamespace: "other-auth" } },
    { member: "cors", changed: { cors: ["https://a"] } },
  ])("detects a change in compared member $member", ({ changed }) => {
    expect(isRequestUnchanged(comparison, { ...sent, ...changed }, existing)).toBe(false);
  });
});

describe("emptyMessageAsUnset", () => {
  test("treats a submessage with no field set as unset", () => {
    expect(emptyMessageAsUnset(IdPPermissionSchema, create(IdPPermissionSchema))).toBeUndefined();
    expect(emptyMessageAsUnset(IdPPermissionSchema, undefined)).toBeUndefined();
  });

  test("keeps a submessage with a field set", () => {
    const permission = create(IdPPermissionSchema, {
      read: [{ permit: IdPPermissionPermit.ALLOW }],
    });

    expect(emptyMessageAsUnset(IdPPermissionSchema, permission)).toBe(permission);
  });
});
