import { describe, expect, test } from "vitest";
import { getMethodDescriptor } from "./proto-reflect";
import { describeFieldType, renderInspectJson, renderInspectText } from "./render";

function getMethod(name: string) {
  const m = getMethodDescriptor(name);
  if (!m) throw new Error(`method ${name} not found`);
  return m;
}

function getField(methodName: string, localName: string) {
  const f = getMethod(methodName).input.fields.find((x) => x.localName === localName);
  expect(f).toBeDefined();
  if (!f) throw new Error(`${localName} not found`);
  return f;
}

describe("describeFieldType", () => {
  test.each`
    name                           | method                           | field                | expected
    ${"renders scalar string"}     | ${"GetApplication"}              | ${"applicationName"} | ${/^string$/}
    ${"renders repeated scalar"}   | ${"CreateApplication"}           | ${"cors"}            | ${/^repeated string$/}
    ${"renders enum"}              | ${"InviteWorkspacePlatformUser"} | ${"role"}            | ${/enum.*WorkspacePlatformUserRole/}
    ${"renders message reference"} | ${"CreateTailorDBType"}          | ${"tailordbType"}    | ${/TailorDBType/}
    ${"renders map type"}          | ${"SetMetadata"}                 | ${"labels"}          | ${/^map</}
  `("$name", ({ method, field, expected }: { method: string; field: string; expected: RegExp }) => {
    expect(describeFieldType(getField(method, field))).toMatch(expected);
  });
});

describe("renderInspectText", () => {
  test("includes method name and field rows", () => {
    const m = getMethod("GetApplication");
    const out = renderInspectText(m);
    expect(out).toMatch(/GetApplication/);
    expect(out).toMatch(/workspaceId/);
    expect(out).toMatch(/applicationName/);
  });

  test("expands nested message fields", () => {
    const m = getMethod("CreateTailorDBType");
    const out = renderInspectText(m);
    expect(out).toMatch(/tailordbType/);
    // Nested fields of TailorDBType (name, schema)
    expect(out).toMatch(/\bname\b/);
  });

  test("annotates oneof membership", () => {
    const m = getMethod("GrantOrganizationAccess");
    const out = renderInspectText(m);
    expect(out).toMatch(/teamId.*\(oneof member\)/);
    expect(out).toMatch(/email.*\(oneof member\)/);
  });
});

describe("renderInspectJson", () => {
  test("returns structured method descriptor", () => {
    const m = getMethod("GetApplication");
    const json = renderInspectJson(m);
    expect(json.method).toBe("GetApplication");
    expect(json.input.typeName).toBe("tailor.v1.GetApplicationRequest");
    const names = json.input.fields.map((f) => f.name);
    expect(names).toContain("workspaceId");
    expect(names).toContain("applicationName");
  });

  test("expands map<K, message> value schema", () => {
    // CreateTailorDBType.tailordbType.schema.fields is map<string, FieldConfig>.
    const m = getMethod("CreateTailorDBType");
    const json = renderInspectJson(m);
    const tailordbType = json.input.fields.find((f) => f.name === "tailordbType");
    const schema = tailordbType?.message?.fields.find((f) => f.name === "schema");
    const mapField = schema?.message?.fields.find((f) => f.fieldKind === "map");
    expect(mapField).toBeDefined();
    expect(mapField?.message).toBeDefined();
    expect(mapField?.message?.fields.length ?? 0).toBeGreaterThan(0);
  });

  test("annotates oneof membership in JSON output", () => {
    // GrantOrganizationAccessRequest.member is oneof { teamId, email, machineUserId }.
    const m = getMethod("GrantOrganizationAccess");
    const json = renderInspectJson(m);
    const teamId = json.input.fields.find((f) => f.name === "teamId");
    const email = json.input.fields.find((f) => f.name === "email");
    const role = json.input.fields.find((f) => f.name === "role");
    expect(teamId?.oneof).toBe("member");
    expect(email?.oneof).toBe("member");
    expect(role?.oneof).toBeUndefined();
  });

  test("marks recursive type references with recursive: true", () => {
    // ListTailorDBTypes.filter.and / .or are repeated Filter, recursive on Filter.
    const m = getMethod("ListTailorDBTypes");
    const json = renderInspectJson(m);
    const filter = json.input.fields.find((f) => f.name === "filter");
    expect(filter?.message).toBeDefined();
    const and = filter?.message?.fields.find((f) => f.name === "and");
    expect(and?.message?.recursive).toBe(true);
    expect(and?.message?.typeName).toMatch(/Filter/);
  });

  test("does not truncate deeply nested method input", () => {
    // CreateTailorDBType has TailorDBType > schema > fields > … reaching depth 9.
    const m = getMethod("CreateTailorDBType");
    const json = renderInspectJson(m);
    function deepestDepth(
      field: { message?: { fields: { name: string; message?: unknown }[] } } | undefined,
      level: number,
    ): number {
      if (!field?.message) return level;
      let max = level;
      for (const sub of field.message.fields) {
        const d = deepestDepth(sub as never, level + 1);
        if (d > max) max = d;
      }
      return max;
    }
    let max = 0;
    for (const top of json.input.fields) {
      const d = deepestDepth(top, 1);
      if (d > max) max = d;
    }
    expect(max).toBeGreaterThan(4);
  });
});
