import { describe, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { toSchemaOutputs } from "#/utils/test/internal";
import { parseFieldConfig } from "./field";
import { setPrecompiledScriptExpr } from "./hooks-validate-precompiled-expr";
import type { UpdateHookFn } from "#/configure/services/tailordb/types";

describe("parseFieldConfig precompiled expressions", () => {
  test("uses precompiled hook expression when attached", () => {
    const createHook = ({ input }: { input: string | null }) => input ?? "fallback";
    setPrecompiledScriptExpr(createHook, "hooks.create", "PRECOMPILED_HOOK_EXPR");

    const type = db.table("User", {
      email: db.string().hooks({ create: createHook }),
    });

    const schema = toSchemaOutputs({ User: type });
    const field = parseFieldConfig(schema.User!.fields.email!);

    expect(field.hooks?.create?.expr).toBe("PRECOMPILED_HOOK_EXPR");
  });

  test("uses precompiled validate expression when attached", () => {
    const validator = ({ value }: { value: string }) =>
      value.length <= 0 ? "Must not be empty" : undefined;
    setPrecompiledScriptExpr(validator, "validate", "PRECOMPILED_VALIDATE_EXPR");

    const type = db.table("User", {
      email: db.string().validate(validator),
    });

    const schema = toSchemaOutputs({ User: type });
    const field = parseFieldConfig(schema.User!.fields.email!);

    expect(field.validate?.[0]?.script.expr).toBe("PRECOMPILED_VALIDATE_EXPR");
  });

  // `db.fields.timestamps()`'s `updatedAt` hook pins this exact expr (see
  // configure/services/tailordb/schema.ts) so that `Function.prototype.toString()`
  // of the built-in hook - which changes across SDK builds (e.g. minification) -
  // never leaks into deployed schemas or migration diffs. This asserts the pinned
  // literal still matches what the same source would naturally produce, so a
  // future change to the call-args template in hook-args-object.ts is caught here
  // instead of silently diverging from the pin.
  test("timestamps() updatedAt hook pin matches its natural expr", () => {
    const updatedAtHook: UpdateHookFn<string | Date | null, string | Date> = ({ input, now }) =>
      input ?? now;

    const type = db.table("User", {
      updatedAt: db.datetime().hooks({ update: updatedAtHook }),
    });

    const schema = toSchemaOutputs({ User: type });
    const field = parseFieldConfig(schema.User!.fields.updatedAt!);

    expect(field.hooks?.update?.expr).toBe(
      "(({ input, now }) => input ?? now)({ input: _value, oldValue: _oldValue, invoker: _principal, now: _now })",
    );
  });

  test("uses the pinned expression from timestamps()", () => {
    const type = db.table("User", {
      ...db.fields.timestamps(),
    });

    const schema = toSchemaOutputs({ User: type });
    const field = parseFieldConfig(schema.User!.fields.updatedAt!);

    expect(field.hooks?.update?.expr).toBe(
      "(({ input, now }) => input ?? now)({ input: _value, oldValue: _oldValue, invoker: _principal, now: _now })",
    );
  });
});
