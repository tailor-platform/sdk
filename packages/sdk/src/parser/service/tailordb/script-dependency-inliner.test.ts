import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { db } from "@/configure/services/tailordb/schema";
import { toSchemaOutputs } from "@/utils/test/internal";
import { parseFieldConfig } from "./field";
import { parseTypes } from "./type-parser";

const EMAIL_SUFFIX = "@example.com";

function normalizeEmail(value: string | null): string {
  return (value ?? `user${EMAIL_SUFFIX}`).toLowerCase();
}

describe("script dependency inliner", () => {
  const currentFilePath = fileURLToPath(import.meta.url);

  it("inlines top-level constants and helper functions for hooks and validators", () => {
    const userType = db.type("User", {
      email: db
        .string()
        .hooks({
          create: ({ value }) => normalizeEmail(value),
        })
        .validate(({ value }) => normalizeEmail(value).endsWith(EMAIL_SUFFIX)),
    });

    const schema = toSchemaOutputs({ User: userType });
    const parsedField = parseFieldConfig(schema.User.fields.email, {
      filePath: currentFilePath,
      exportName: "userType",
    });

    expect(parsedField.hooks?.create?.expr).toContain("const EMAIL_SUFFIX =");
    expect(parsedField.hooks?.create?.expr).toContain("function normalizeEmail(");
    expect(parsedField.validate?.[0]?.script.expr).toContain("const EMAIL_SUFFIX =");
    expect(parsedField.validate?.[0]?.script.expr).toContain("function normalizeEmail(");
  });

  it("keeps rejecting external captures when source info is not available", () => {
    const userType = db.type("User", {
      email: db.string().validate(({ value }) => normalizeEmail(value).endsWith(EMAIL_SUFFIX)),
    });

    expect(() => parseTypes(toSchemaOutputs({ User: userType }), "test-namespace")).toThrow(
      /captures external variables/,
    );
  });

  it("allows external captures when source info is available", () => {
    const userType = db.type("User", {
      email: db
        .string()
        .hooks({
          create: ({ value }) => normalizeEmail(value),
        })
        .validate(({ value }) => normalizeEmail(value).endsWith(EMAIL_SUFFIX)),
    });

    const result = parseTypes(toSchemaOutputs({ User: userType }), "test-namespace", {
      User: {
        filePath: currentFilePath,
        exportName: "userType",
      },
    });

    expect(result.User.fields.email.config.hooks?.create?.expr).toContain("const EMAIL_SUFFIX =");
    expect(result.User.fields.email.config.validate?.[0]?.script.expr).toContain(
      "function normalizeEmail(",
    );
  });
});
