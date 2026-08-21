import { describe, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { TIMESTAMPS_UPDATED_AT_HOOK_EXPR } from "#/configure/services/tailordb/timestamps-updated-at-hook.generated";
import { toSchemaOutputs } from "#/utils/test/internal";
import { parseFieldConfig } from "./field";
import { setPrecompiledScriptExpr } from "./hooks-validate-precompiled-expr";

describe("parseFieldConfig precompiled expressions", () => {
  test("uses precompiled hook expression when attached", () => {
    const createHook = ({ input }: { input: string | null }) => input ?? "fallback";
    setPrecompiledScriptExpr(createHook, "PRECOMPILED_HOOK_EXPR");

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
    setPrecompiledScriptExpr(validator, "PRECOMPILED_VALIDATE_EXPR");

    const type = db.table("User", {
      email: db.string().validate(validator),
    });

    const schema = toSchemaOutputs({ User: type });
    const field = parseFieldConfig(schema.User!.fields.email!);

    expect(field.validate?.[0]?.script.expr).toBe("PRECOMPILED_VALIDATE_EXPR");
  });

  // `db.fields.timestamps()`'s `updatedAt` hook pins its expr (see
  // configure/services/tailordb/schema.ts) so that `Function.prototype.toString()`
  // of the built-in hook - which changes across SDK builds (e.g. minification) -
  // never leaks into deployed schemas or migration diffs. The pinned value is
  // generated from that hook's own source by `pnpm generate`
  // (scripts/generate-precompiled-hooks.ts), not hand-typed, so this only needs to
  // confirm the real field wires up to it.
  test("timestamps() updatedAt hook resolves to the generated pin", () => {
    const type = db.table("User", { ...db.fields.timestamps() });

    const schema = toSchemaOutputs({ User: type });
    const field = parseFieldConfig(schema.User!.fields.updatedAt!);

    expect(field.hooks?.update?.expr).toBe(TIMESTAMPS_UPDATED_AT_HOOK_EXPR);
  });
});
