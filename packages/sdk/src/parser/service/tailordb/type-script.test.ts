import { describe, expect, test } from "vitest";
import { buildTypeScripts, type ScriptFieldConfig } from "./type-script";

describe("buildTypeScripts", () => {
  test("returns empty result when no field has hooks or validators", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      id: { type: "uuid" },
      name: { type: "string" },
    };
    expect(buildTypeScripts(fields)).toEqual({});
  });

  test("aggregates field hooks into one script binding a shared timestamp", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      createdAt: {
        type: "datetime",
        hooks: { create: { expr: "_now" } },
      },
      updatedAt: {
        type: "datetime",
        hooks: { create: { expr: "_now" }, update: { expr: "_now" } },
      },
    };

    const { typeHook, typeValidate } = buildTypeScripts(fields);
    expect(typeValidate).toBeUndefined();

    // A single `new Date()` is bound once and dispatched to every field.
    const createExpr = typeHook?.create?.expr ?? "";
    expect(createExpr.match(/new Date\(\)/g)).toHaveLength(1);
    expect(createExpr).toContain('"createdAt": ((_value) => (_now))(_input["createdAt"])');
    expect(createExpr).toContain('"updatedAt": ((_value) => (_now))(_input["updatedAt"])');

    // createdAt has no update hook, so the update script only touches updatedAt.
    const updateExpr = typeHook?.update?.expr ?? "";
    expect(updateExpr).toContain('"updatedAt":');
    expect(updateExpr).not.toContain('"createdAt":');
  });

  test("reconstructs nested objects so unhooked siblings are preserved", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      profile: {
        type: "nested",
        fields: {
          displayName: { type: "string", hooks: { create: { expr: "_value.trim()" } } },
          contact: {
            type: "nested",
            fields: {
              email: { type: "string", hooks: { create: { expr: "_value.toLowerCase()" } } },
            },
          },
        },
      },
    };

    const createExpr = buildTypeScripts(fields).typeHook?.create?.expr ?? "";
    expect(createExpr).toContain('"profile": Object.assign({}, _input["profile"], {');
    expect(createExpr).toContain('(_input["profile"] || {})["displayName"]');
    expect(createExpr).toContain(
      '"contact": Object.assign({}, (_input["profile"] || {})["contact"], {',
    );
    expect(createExpr).toContain('((_input["profile"] || {})["contact"] || {})["email"]');
  });

  test("applies default as ?? fallback after hook on create only", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      status: {
        type: "enum",
        default: "active",
        hooks: { create: { expr: "_value" } },
      },
      name: {
        type: "string",
        default: "unnamed",
      },
    };

    const { typeHook } = buildTypeScripts(fields);
    const createExpr = typeHook?.create?.expr ?? "";

    // hook + default: hookResult ?? defaultValue
    expect(createExpr).toContain('"status": ((_value) => (_value))(_input["status"]) ?? "active"');
    // default only: input ?? defaultValue
    expect(createExpr).toContain('"name": _input["name"] ?? "unnamed"');

    // defaults are create-only — update script should not include them
    expect(typeHook?.update).toBeUndefined();
  });

  test("uses _now for datetime/date/time defaults with 'now'", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      createdAt: { type: "datetime", default: "now" },
      startDate: { type: "date", default: "now" },
      startTime: { type: "time", default: "now" },
      label: { type: "string", default: "now" },
    };

    const createExpr = buildTypeScripts(fields).typeHook?.create?.expr ?? "";
    expect(createExpr).toContain('"createdAt": _input["createdAt"] ?? _now');
    expect(createExpr).toContain('"startDate": _input["startDate"] ?? _now');
    expect(createExpr).toContain('"startTime": _input["startTime"] ?? _now');
    // "now" on a string field is just a literal string, not _now
    expect(createExpr).toContain('"label": _input["label"] ?? "now"');
  });

  test("builds a validate script keyed by dotted path with negated boolean checks", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      age: {
        type: "integer",
        validate: [
          { script: { expr: "_value >= 0" }, errorMessage: "must be >= 0" },
          { script: { expr: "_value < 200" }, errorMessage: "must be < 200" },
        ],
      },
    };

    const { typeValidate, typeHook } = buildTypeScripts(fields);
    expect(typeHook).toBeUndefined();

    const createExpr = typeValidate?.create?.expr ?? "";
    // Same rules apply to create and update.
    expect(typeValidate?.update?.expr).toBe(createExpr);
    expect(createExpr).toContain("const __errs = {}");
    expect(createExpr).toContain('if (!(_value >= 0)) { __errs["age"] = "must be >= 0"; }');
    expect(createExpr).toContain('else if (!(_value < 200)) { __errs["age"] = "must be < 200"; }');
    expect(createExpr).toContain("return __errs");
    // `now` is a hook-only concept; validators must not bind a timestamp.
    expect(createExpr).not.toContain("new Date()");
  });
});
