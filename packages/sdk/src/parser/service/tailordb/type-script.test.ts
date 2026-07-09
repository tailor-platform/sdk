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
    expect(createExpr).toContain(
      '"createdAt": ((_value, _oldValue) => (_now))(_input["createdAt"], _oldRecord?.["createdAt"] ?? null)',
    );
    expect(createExpr).toContain(
      '"updatedAt": ((_value, _oldValue) => (_now))(_input["updatedAt"], _oldRecord?.["updatedAt"] ?? null)',
    );

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
    expect(createExpr).toContain(
      '(_input["profile"] || {})["displayName"], _oldRecord?.["profile"]?.["displayName"] ?? null)',
    );
    expect(createExpr).toContain(
      '"contact": Object.assign({}, (_input["profile"] || {})["contact"], {',
    );
    expect(createExpr).toContain(
      '((_input["profile"] || {})["contact"] || {})["email"], _oldRecord?.["profile"]?.["contact"]?.["email"] ?? null)',
    );
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
    expect(createExpr).toContain(
      '"status": ((_value, _oldValue) => (_value))(_input["status"], _oldRecord?.["status"] ?? null) ?? "active"',
    );
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

  test("builds a validate script that runs all validators and collects all errors", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      age: {
        type: "integer",
        validate: [
          { script: { expr: "_value >= 0" }, errorMessage: "" },
          { script: { expr: "_value < 200" }, errorMessage: "" },
        ],
      },
    };

    const { typeValidate, typeHook } = buildTypeScripts(fields);
    expect(typeHook).toBeUndefined();

    const createExpr = typeValidate?.create?.expr ?? "";
    expect(typeValidate?.update?.expr).toBe(createExpr);
    expect(createExpr).toContain("const __errs = {}");
    expect(createExpr).toContain('const _value = _newRecord["age"]');
    expect(createExpr).not.toContain("_oldValue");
    expect(createExpr).toContain("(_value >= 0)");
    expect(createExpr).toContain("(_value < 200)");
    expect(createExpr).toContain('if (typeof __r === "string") { __errs["age"] = __r; }');
    expect(createExpr).toContain("return __errs");
    expect(createExpr).not.toContain("new Date()");
  });

  test("includes type-level validate with __issues function", () => {
    const typeValidateExpr =
      '(({ newRecord }) => { if (newRecord.start > newRecord.end) __issues("start", "bad"); })({ newRecord: _newRecord, oldRecord: _oldRecord }, __issues)';

    const { typeValidate } = buildTypeScripts({}, { typeValidateExpr });
    const expr = typeValidate?.create?.expr ?? "";
    expect(typeValidate?.update?.expr).toBe(expr);
    expect(expr).toContain("const __errs = {}");
    expect(expr).toContain("const __issues = (f, m) => { __errs[f] = m; }");
    expect(expr).toContain(typeValidateExpr);
    expect(expr).toContain("return __errs");
  });

  test("combines field validators and type-level validate in one script", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      name: {
        type: "string",
        validate: [{ script: { expr: "checkName(_value)" }, errorMessage: "" }],
      },
    };
    const typeValidateExpr = "typeValidateFn({ newRecord: _newRecord }, __issues)";

    const { typeValidate } = buildTypeScripts(fields, { typeValidateExpr });
    const expr = typeValidate?.create?.expr ?? "";
    expect(expr).toContain('const _value = _newRecord["name"]');
    expect(expr).toContain("const __issues = (f, m) => { __errs[f] = m; }");
    expect(expr).toContain(typeValidateExpr);
  });

  test("no typeValidate output when no field validators and no type-level validate", () => {
    expect(buildTypeScripts({})).toEqual({});
    expect(buildTypeScripts({}, undefined)).toEqual({});
  });

  test("captures _invoker safely so scripts work when Platform does not inject it", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      createdAt: {
        type: "datetime",
        hooks: { create: { expr: "_now" } },
      },
    };
    const typeHookExpr = {
      create: "(({ input }) => ({ computed: input.a }))({ input: _input, invoker: _invoker })",
    };

    const { typeHook } = buildTypeScripts(fields, { typeHookExpr });

    const hookExpr = typeHook?.create?.expr ?? "";
    expect(hookExpr).toMatch(/^\(\(_invoker\) =>/);
    expect(hookExpr).toContain('typeof _invoker !== "undefined" ? _invoker : undefined');

    const validateExpr =
      buildTypeScripts(
        { x: { type: "string", validate: [{ script: { expr: "true" }, errorMessage: "" }] } },
        { typeValidateExpr: "fn(_invoker)" },
      ).typeValidate?.create?.expr ?? "";
    expect(validateExpr).toMatch(/^\(\(_invoker\) =>/);
    expect(validateExpr).toContain('typeof _invoker !== "undefined" ? _invoker : undefined');
  });
});
