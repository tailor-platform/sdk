import { describe, expect, test } from "vitest";
import { mergeFieldEntries } from "./field-merge";
import { getMethodDescriptor } from "./proto-reflect";

function methodInput(name: string) {
  const m = getMethodDescriptor(name);
  if (!m) throw new Error(`method not found: ${name}`);
  return m.input;
}

describe("mergeFieldEntries", () => {
  test("returns body unchanged when no entries", () => {
    const r = mergeFieldEntries({
      body: { foo: "bar" },
      entries: [],
      methodInput: methodInput("GetApplication"),
    });
    expect(r).toEqual({ ok: true, body: { foo: "bar" } });
  });

  test("sets a single string scalar", () => {
    const r = mergeFieldEntries({
      body: {},
      entries: ["applicationName=app1"],
      methodInput: methodInput("GetApplication"),
    });
    expect(r).toEqual({ ok: true, body: { applicationName: "app1" } });
  });

  test("supports multiple scalar fields", () => {
    const r = mergeFieldEntries({
      body: {},
      entries: ["workspaceId=ws", "applicationName=app1"],
      methodInput: methodInput("GetApplication"),
    });
    expect(r).toEqual({
      ok: true,
      body: { workspaceId: "ws", applicationName: "app1" },
    });
  });

  test("body field is overridden by --field", () => {
    const r = mergeFieldEntries({
      body: { applicationName: "old" },
      entries: ["applicationName=new"],
      methodInput: methodInput("GetApplication"),
    });
    expect(r).toEqual({ ok: true, body: { applicationName: "new" } });
  });

  test("preserves body fields not touched by --field", () => {
    const r = mergeFieldEntries({
      body: { workspaceId: "ws", applicationName: "app1" },
      entries: ["applicationName=app2"],
      methodInput: methodInput("GetApplication"),
    });
    expect(r).toEqual({
      ok: true,
      body: { workspaceId: "ws", applicationName: "app2" },
    });
  });

  test("coerces bool scalars", () => {
    const r = mergeFieldEntries({
      body: {},
      entries: ["disabled=true", "disableIntrospection=false"],
      methodInput: methodInput("CreateApplication"),
    });
    expect(r).toEqual({
      ok: true,
      body: { disabled: true, disableIntrospection: false },
    });
  });

  test("coerces enum scalars by proto name", () => {
    const r = mergeFieldEntries({
      body: {},
      entries: ["role=WORKSPACE_PLATFORM_USER_ROLE_ADMIN"],
      methodInput: methodInput("InviteWorkspacePlatformUser"),
    });
    expect(r).toEqual({
      ok: true,
      body: { role: "WORKSPACE_PLATFORM_USER_ROLE_ADMIN" },
    });
  });

  test("rejects unknown enum value with suggestions", () => {
    const r = mergeFieldEntries({
      body: {},
      entries: ["role=ROLE_OWNER"],
      methodInput: methodInput("InviteWorkspacePlatformUser"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/WORKSPACE_PLATFORM_USER_ROLE_ADMIN/);
  });

  test("repeated scalar list collects into array", () => {
    const r = mergeFieldEntries({
      body: {},
      entries: ["cors=https://a.example", "cors=https://b.example"],
      methodInput: methodInput("CreateApplication"),
    });
    expect(r).toEqual({
      ok: true,
      body: { cors: ["https://a.example", "https://b.example"] },
    });
  });

  test("rejects double-set on non-repeated scalar", () => {
    const r = mergeFieldEntries({
      body: {},
      entries: ["applicationName=a", "applicationName=b"],
      methodInput: methodInput("GetApplication"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/repeated|multiple/i);
  });

  test("rejects entry without '='", () => {
    const r = mergeFieldEntries({
      body: {},
      entries: ["workspaceId"],
      methodInput: methodInput("GetApplication"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/=/);
  });

  test("rejects unknown top-level field with suggestion", () => {
    const r = mergeFieldEntries({
      body: {},
      entries: ["fooBar=x"],
      methodInput: methodInput("GetApplication"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/workspaceId|applicationName|unknown/);
  });

  test("rejects snake_case key with camelCase suggestion", () => {
    const r = mergeFieldEntries({
      body: {},
      entries: ["application_name=app"],
      methodInput: methodInput("GetApplication"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/applicationName/);
  });

  test("supports dot-notation for nested message", () => {
    const r = mergeFieldEntries({
      body: {},
      entries: ["tailordbType.name=User"],
      methodInput: methodInput("CreateTailorDBType"),
    });
    expect(r).toEqual({
      ok: true,
      body: { tailordbType: { name: "User" } },
    });
  });

  test("merges multiple dot-notation entries on same parent", () => {
    const r = mergeFieldEntries({
      body: { tailordbType: { name: "Old" } },
      entries: ["tailordbType.name=New"],
      methodInput: methodInput("CreateTailorDBType"),
    });
    expect(r).toEqual({
      ok: true,
      body: { tailordbType: { name: "New" } },
    });
  });

  test("rejects nesting into a scalar field", () => {
    const r = mergeFieldEntries({
      body: {},
      entries: ["applicationName.foo=bar"],
      methodInput: methodInput("GetApplication"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/scalar|nest/i);
  });

  test("rejects directly assigning a message field without dot", () => {
    const r = mergeFieldEntries({
      body: {},
      entries: ["tailordbType=foo"],
      methodInput: methodInput("CreateTailorDBType"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/dot-notation|message/i);
  });

  test("rejects map field with --body suggestion", () => {
    const r = mergeFieldEntries({
      body: {},
      entries: ["labels.foo=bar"],
      methodInput: methodInput("SetMetadata"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/map|--body/i);
  });

  test("rejects nesting into repeated message field", () => {
    // CreateApplication.subgraphs is `repeated Subgraph`; proto JSON is an
    // array, not an object — dot-notation cannot build it.
    const r = mergeFieldEntries({
      body: {},
      entries: ["subgraphs.serviceType=PIPELINE"],
      methodInput: methodInput("CreateApplication"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/repeated message|--body/i);
  });

  test("oneof: --field overrides body sibling case", () => {
    // GrantOrganizationAccess.member is oneof { teamId, email, machineUserId }.
    const r = mergeFieldEntries({
      body: { teamId: "t1" },
      entries: ["email=a@b"],
      methodInput: methodInput("GrantOrganizationAccess"),
    });
    expect(r).toEqual({ ok: true, body: { email: "a@b" } });
  });

  test("oneof: --field rejects conflicting cases from --field", () => {
    const r = mergeFieldEntries({
      body: {},
      entries: ["teamId=t1", "email=a@b"],
      methodInput: methodInput("GrantOrganizationAccess"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/oneof|member/i);
  });

  test("oneof: same case set twice still respects single-set rule", () => {
    const r = mergeFieldEntries({
      body: {},
      entries: ["teamId=t1", "teamId=t2"],
      methodInput: methodInput("GrantOrganizationAccess"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/repeated|multiple/i);
  });

  test("rejects nesting into google.protobuf well-known type", () => {
    // UpdateApplication.update_mask is google.protobuf.FieldMask; proto JSON
    // uses a comma-delimited string, not nested object.
    const r = mergeFieldEntries({
      body: {},
      entries: ["updateMask.paths=foo"],
      methodInput: methodInput("UpdateApplication"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/google\.protobuf|well-known|--body/i);
  });
});
