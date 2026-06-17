import { describe, expect, test } from "vitest";
import { db } from "#src/configure/services/tailordb/schema";
import { toSchemaOutputs } from "#src/utils/test/internal";
import { parseFieldConfig } from "./field";
import { setPrecompiledScriptExpr } from "./hooks-validate-precompiled-expr";

describe("parseFieldConfig precompiled expressions", () => {
  test("uses precompiled hook expression when attached", () => {
    const createHook = ({ value }: { value: string | null }) => value ?? "fallback";
    setPrecompiledScriptExpr(createHook, "PRECOMPILED_HOOK_EXPR");

    const type = db.type("User", {
      email: db.string().hooks({ create: createHook }),
    });

    const schema = toSchemaOutputs({ User: type });
    const field = parseFieldConfig(schema.User!.fields.email!);

    expect(field.hooks?.create?.expr).toBe("PRECOMPILED_HOOK_EXPR");
  });

  test("uses precompiled validate expression when attached", () => {
    const validator = ({ value }: { value: string }) => value.length > 0;
    setPrecompiledScriptExpr(validator, "PRECOMPILED_VALIDATE_EXPR");

    const type = db.type("User", {
      email: db.string().validate(validator),
    });

    const schema = toSchemaOutputs({ User: type });
    const field = parseFieldConfig(schema.User!.fields.email!);

    expect(field.validate?.[0]?.script.expr).toBe("PRECOMPILED_VALIDATE_EXPR");
  });
});
