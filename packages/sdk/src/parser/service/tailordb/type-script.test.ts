import { describe, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { toSchemaOutputs } from "#/utils/test/internal";
import { parseFieldConfig } from "./field";
import { parseTypes } from "./type-parser";
import {
  buildTypeScripts,
  computeSourceScriptHash,
  extractSourceScriptHash,
  type ScriptFieldConfig,
} from "./type-script";

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

  test("embeds the invoker normalization once per type instead of once per field hook", () => {
    const type = db.table("Widget", {
      a: db.string().hooks({ create: ({ input }) => input ?? "a" }),
      b: db.string().hooks({ create: ({ input }) => input ?? "b" }),
      c: db.string().hooks({ create: ({ input }) => input ?? "c" }),
    });
    const schema = toSchemaOutputs({ Widget: type });
    const fields: Record<string, ScriptFieldConfig> = {
      a: parseFieldConfig(schema.Widget!.fields.a!),
      b: parseFieldConfig(schema.Widget!.fields.b!),
      c: parseFieldConfig(schema.Widget!.fields.c!),
    };

    const createExpr = buildTypeScripts(fields).typeHook?.create?.expr ?? "";

    expect(createExpr.match(/USER_TYPE_MACHINE_USER/g)).toHaveLength(1);
  });

  test("delivers one normalized invoker to a field hook, a type-level hook, and type-level validate", () => {
    const type = db
      .table("Widget", {
        name: db
          .string()
          .hooks({ create: ({ input, invoker }) => invoker?.type ?? input ?? "unknown" }),
      })
      .hooks({ create: ({ input }) => ({ name: `${input.name}-typed` }) })
      .validate(({ invoker }, issues) => {
        if (!invoker) issues("name", "missing invoker");
      });

    const parsed = parseTypes({ Widget: toSchemaOutputs({ Widget: type }).Widget! }, "ns").Widget!;
    const fields: Record<string, ScriptFieldConfig> = Object.fromEntries(
      Object.entries(parsed.fields).map(([name, field]) => [name, field.config]),
    );

    const { typeHook, typeValidate } = buildTypeScripts(fields, {
      typeHookExpr: parsed.typeHookExpr,
      typeValidateExpr: parsed.typeValidateExpr,
    });
    const createExpr = typeHook?.create?.expr ?? "";
    const validateExpr = typeValidate?.create?.expr ?? "";

    // The mapping is generated once for the type, not once per hook/validator.
    expect(createExpr.match(/USER_TYPE_MACHINE_USER/g)).toHaveLength(1);
    expect(validateExpr.match(/USER_TYPE_MACHINE_USER/g)).toHaveLength(1);

    const rawUser = { type: "USER_TYPE_MACHINE_USER", id: "11111111-1111-1111-1111-111111111111" };
    const created = new Function("_input", "_oldRecord", "user", `return ${createExpr}`)(
      { name: "orig" },
      null,
      rawUser,
    );
    expect(created.name).toBe("machine_user-typed");

    const errors = new Function("_newRecord", "_oldRecord", "user", `return ${validateExpr}`)(
      { name: "orig" },
      null,
      rawUser,
    );
    expect(errors).toEqual({});
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

  test("throws on defaults on nested array inner fields", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      items: {
        type: "nested",
        array: true,
        fields: {
          status: { type: "string", default: "pending" },
        },
      },
    };

    expect(() => buildTypeScripts(fields)).toThrow(
      '.default() cannot be used on nested inner field "status"',
    );
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

  test("nested array forEach terminates with semicolon to prevent ASI with type-level validate", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      items: {
        type: "nested",
        array: true,
        fields: {
          qty: {
            type: "integer",
            validate: [{ script: { expr: "_value > 0" }, errorMessage: "" }],
          },
        },
      },
    };
    const typeValidateExpr = "fn({ newRecord: _newRecord }, __issues)";

    const { typeValidate } = buildTypeScripts(fields, { typeValidateExpr });
    const expr = typeValidate?.create?.expr ?? "";
    expect(expr).toContain("});");

    const _newRecord = { items: [{ qty: 1 }] }; // eslint-disable-line
    const fn = () => {}; // eslint-disable-line
    expect(() => new Function("_newRecord", "fn", `return ${expr}`)(_newRecord, fn)).not.toThrow();
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

  test("skips nested object child validators when parent is absent", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      address: {
        type: "nested",
        fields: {
          city: {
            type: "string",
            validate: [
              { script: { expr: '_value.length > 0 ? undefined : "required"' }, errorMessage: "" },
            ],
          },
        },
      },
    };

    const expr = buildTypeScripts(fields).typeValidate?.create?.expr ?? "";
    expect(expr).toContain('if (_newRecord["address"] != null)');

    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const run = (record: unknown) => new Function("_newRecord", `return ${expr}`)(record);
    expect(run({ address: null })).toEqual({});
    expect(run({ address: { city: "" } })).toEqual({ "address.city": "required" });
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

  test("update type-level hook falls back to oldRecord via _oldRecord", () => {
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
    const typeHookExpr = {
      create:
        "(({ input }) => ({ label: `${input.name} Bundle` }))({ input: _input, oldRecord: _oldRecord, invoker: _invoker, now: _now })",
      update:
        "(({ input, oldRecord }) => ({ label: `${input.name ?? oldRecord.name} Bundle` }))({ input: _input, oldRecord: _oldRecord, invoker: _invoker, now: _now })",
    };

    const { typeHook } = buildTypeScripts(fields, { typeHookExpr });

    // UPDATE: input has no name, oldRecord has name
    const updateExpr = typeHook?.update?.expr ?? "";
    const _input = { items: [{ productName: "Item", qty: 3, unitPrice: 5.0 }] }; // eslint-disable-line
    const _oldRecord = {
      // eslint-disable-line
      id: "abc",
      name: "Stable",
      label: "Stable Bundle",
      items: [{ productName: "Item", qty: 1, unitPrice: 5.0 }],
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    };
    const result = new Function("_input", "_oldRecord", `return ${updateExpr}`)(_input, _oldRecord);
    expect(result.label).toBe("Stable Bundle");
  });

  test("nested array hooks do not reference __oldEl", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      items: {
        type: "nested",
        array: true,
        fields: {
          qty: {
            type: "integer",
            hooks: { update: { expr: "_value ?? _oldValue" } },
          },
        },
      },
    };

    const updateExpr = buildTypeScripts(fields).typeHook?.update?.expr ?? "";
    expect(updateExpr).not.toContain("__oldEl");
  });
});

describe("computeSourceScriptHash", () => {
  test("returns undefined when no script-relevant data exists", () => {
    expect(computeSourceScriptHash({ id: { type: "uuid" } })).toBeUndefined();
    expect(computeSourceScriptHash({})).toBeUndefined();
  });

  test("returns a 16-char hex string when scripts exist", () => {
    const hash = computeSourceScriptHash({
      name: { type: "string", hooks: { create: { expr: "_value.trim()" } } },
    });
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  test("is deterministic for the same input", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      status: { type: "string", default: "active" },
      name: { type: "string", hooks: { create: { expr: "_value.trim()" } } },
    };
    expect(computeSourceScriptHash(fields)).toBe(computeSourceScriptHash(fields));
  });

  test("changes when a hook expression changes", () => {
    const a = computeSourceScriptHash({
      name: { type: "string", hooks: { create: { expr: "_value.trim()" } } },
    });
    const b = computeSourceScriptHash({
      name: { type: "string", hooks: { create: { expr: "_value.toLowerCase()" } } },
    });
    expect(a).not.toBe(b);
  });

  test("changes when typeHookExpr changes", () => {
    const fields: Record<string, ScriptFieldConfig> = {};
    const a = computeSourceScriptHash(fields, { typeHookExpr: { create: "exprA" } });
    const b = computeSourceScriptHash(fields, { typeHookExpr: { create: "exprB" } });
    expect(a).not.toBe(b);
  });

  test("changes when typeValidateExpr changes", () => {
    const a = computeSourceScriptHash({}, { typeValidateExpr: "validateA" });
    const b = computeSourceScriptHash({}, { typeValidateExpr: "validateB" });
    expect(a).not.toBe(b);
  });

  test("is insensitive to field insertion order", () => {
    const a = computeSourceScriptHash({
      alpha: { type: "string", hooks: { create: { expr: "a" } } },
      beta: { type: "string", hooks: { create: { expr: "b" } } },
    });
    const b = computeSourceScriptHash({
      beta: { type: "string", hooks: { create: { expr: "b" } } },
      alpha: { type: "string", hooks: { create: { expr: "a" } } },
    });
    expect(a).toBe(b);
  });

  test("includes nested field scripts in hash", () => {
    const withNested = computeSourceScriptHash({
      profile: {
        type: "nested",
        fields: {
          email: { type: "string", hooks: { create: { expr: "_value.toLowerCase()" } } },
        },
      },
    });
    const withoutNested = computeSourceScriptHash({
      profile: { type: "nested", fields: { email: { type: "string" } } },
    });
    expect(withNested).toBeDefined();
    expect(withoutNested).toBeUndefined();
  });
});

describe("extractSourceScriptHash", () => {
  test("extracts hash from expr with hash suffix", () => {
    const expr = "((_invoker) => { return {}; })() // @sdk-source-hash:abcdef0123456789";
    expect(extractSourceScriptHash(expr)).toBe("abcdef0123456789");
  });

  test("returns undefined when no hash is present", () => {
    expect(extractSourceScriptHash("((_invoker) => { return {}; })()")).toBeUndefined();
  });
});

describe("buildTypeScripts hash embedding", () => {
  test("embeds hash in generated hook expr", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      createdAt: { type: "datetime", hooks: { create: { expr: "_now" } } },
    };
    const { typeHook } = buildTypeScripts(fields);
    const expr = typeHook?.create?.expr ?? "";
    const hash = extractSourceScriptHash(expr);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hash).toBe(computeSourceScriptHash(fields));
  });

  test("embeds same hash in all generated exprs", () => {
    const fields: Record<string, ScriptFieldConfig> = {
      name: {
        type: "string",
        hooks: { create: { expr: "_value.trim()" }, update: { expr: "_value.trim()" } },
        validate: [{ script: { expr: "_value.length > 0" }, errorMessage: "required" }],
      },
    };
    const { typeHook, typeValidate } = buildTypeScripts(fields);
    const hashes = [
      extractSourceScriptHash(typeHook?.create?.expr ?? ""),
      extractSourceScriptHash(typeHook?.update?.expr ?? ""),
      extractSourceScriptHash(typeValidate?.create?.expr ?? ""),
      extractSourceScriptHash(typeValidate?.update?.expr ?? ""),
    ];
    expect(new Set(hashes).size).toBe(1);
    expect(hashes[0]).toMatch(/^[0-9a-f]{16}$/);
  });

  test("no hash in empty result", () => {
    expect(buildTypeScripts({ id: { type: "uuid" } })).toEqual({});
  });
});
