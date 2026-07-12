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
    expect(createExpr).toContain(
      '"displayName": ((_value) => (_value.trim()))((_input["profile"] || {})["displayName"])',
    );
    expect(createExpr).toContain(
      '"contact": Object.assign({}, (_input["profile"] || {})["contact"], {',
    );
    expect(createExpr).toContain(
      '"email": ((_value) => (_value.toLowerCase()))(((_input["profile"] || {})["contact"] || {})["email"])',
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

  test("ignores defaults on nested array inner fields", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      items: {
        type: "nested",
        array: true,
        fields: {
          status: { type: "string", default: "pending" },
          count: { type: "integer", default: 0 },
        },
      },
    };

    expect(buildTypeScripts(fields)).toEqual({});
  });

  test("validates per element in nested array fields with indexed error paths", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      items: {
        type: "nested",
        array: true,
        fields: {
          name: {
            type: "string",
            validate: [
              { script: { expr: '_value.length > 0 ? undefined : "required"' }, errorMessage: "" },
            ],
          },
        },
      },
    };

    const expr = buildTypeScripts(fields).typeValidate?.create?.expr ?? "";
    expect(expr).toContain('(_newRecord["items"] || []).forEach((__el, __idx) => {');
    expect(expr).toContain('const _value = __el["name"]');
    expect(expr).toContain('"items[" + __idx + "].name"');
  });

  test("skips nested array with no defaults or validators", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      items: {
        type: "nested",
        array: true,
        fields: {
          name: { type: "string" },
        },
      },
    };
    expect(buildTypeScripts(fields)).toEqual({});
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

  test("type-level hook receives field-level results as input, not raw _input", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      status: { type: "string", default: "active" },
    };
    const typeHookExpr = {
      create:
        "(({ input }) => ({ label: input.status }))({ input: _input, oldRecord: _oldRecord, invoker: _invoker, now: _now })",
    };

    const { typeHook } = buildTypeScripts(fields, { typeHookExpr });
    const expr = typeHook?.create?.expr ?? "";

    // Field-level result is bound to __fl
    expect(expr).toContain("const __fl =");
    expect(expr).toContain('"status": _input["status"] ?? "active"');

    // Type-level hook receives field-level result via IIFE that shadows _input
    expect(expr).toContain("((_input) =>");
    expect(expr).toContain("Object.assign({}, _input, __fl)");

    // Final result merges field-level and type-level
    expect(expr).toContain("Object.assign({}, __fl,");
  });

  test("field-level + type-level hook evaluates correctly at runtime", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      name: { type: "string", hooks: { create: { expr: "_value.trim()" } } },
    };
    const typeHookExpr = {
      create:
        "(({ input }) => ({ upper: input.name.toUpperCase() }))({ input: _input, oldRecord: _oldRecord, invoker: _invoker, now: _now })",
    };

    const { typeHook } = buildTypeScripts(fields, { typeHookExpr });
    const expr = typeHook?.create?.expr ?? "";

    // Evaluate the generated expression with a mock _input
    const _input = { name: "  hello  " }; // eslint-disable-line
    const _oldRecord = null; // eslint-disable-line
    const result = new Function("_input", "_oldRecord", `return ${expr}`)(_input, _oldRecord);
    // Field-level hook trims name
    expect(result.name).toBe("hello");
    // Type-level hook sees trimmed input and uppercases it
    expect(result.upper).toBe("HELLO");
  });

  test("nested array hooks do not reference __oldEl", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      items: {
        type: "nested",
        array: true,
        fields: {
          qty: {
            type: "integer",
            default: 1,
            hooks: { update: { expr: "_value ?? _oldValue" } },
          },
        },
      },
    };

    const updateExpr = buildTypeScripts(fields).typeHook?.update?.expr ?? "";
    expect(updateExpr).not.toContain("__oldEl");
  });
});
