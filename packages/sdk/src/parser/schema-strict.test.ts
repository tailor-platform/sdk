import { describe, expect, test } from "vitest";
import { AppConfigSchema } from "./app-config/schema";
import { PluginConfigSchema } from "./plugin-config/schema";
import { AIGatewaySchema } from "./service/aigateway/schema";
import { AuthConnectionConfigSchema } from "./service/auth-connection/schema";
import { AuthConfigSchema, SCIMAttributeSchema } from "./service/auth/schema";
import { ExecutorSchema } from "./service/executor/schema";
import { TailorFieldSchema } from "./service/field/schema";
import { IdPSchema } from "./service/idp/schema";
import { ResolverSchema } from "./service/resolver/schema";
import { SecretsSchema } from "./service/secrets/schema";
import { StaticWebsiteSchema } from "./service/staticwebsite/schema";
import { TailorDBServiceConfigSchema, TailorDBTypeSchema } from "./service/tailordb/schema";
import { WorkflowSchema } from "./service/workflow/schema";
import type { ZodType } from "zod";

type StrictSchemaCase = {
  readonly name: string;
  readonly schema: ZodType;
  readonly value: Record<string, unknown>;
};

function hasUnrecognizedKeyIssue(issues: readonly unknown[]): boolean {
  return issues.some((issue) => {
    if (typeof issue !== "object" || issue === null) return false;
    if ("code" in issue && issue.code === "unrecognized_keys") return true;
    if (!("errors" in issue) || !Array.isArray(issue.errors)) return false;
    return issue.errors.some(
      (variantIssues) => Array.isArray(variantIssues) && hasUnrecognizedKeyIssue(variantIssues),
    );
  });
}

const strictSchemaCases: StrictSchemaCase[] = [
  {
    name: "app config",
    schema: AppConfigSchema,
    value: { name: "my-app" },
  },
  {
    name: "AI gateway",
    schema: AIGatewaySchema,
    value: { name: "my-gateway", authNamespace: "my-auth" },
  },
  {
    name: "auth connection",
    schema: AuthConnectionConfigSchema,
    value: {
      type: "oauth2",
      providerUrl: "https://accounts.example.com",
      issuerUrl: "https://accounts.example.com",
      clientId: "client-id",
      clientSecret: "client-secret",
    },
  },
  {
    name: "auth config",
    schema: AuthConfigSchema,
    value: { name: "my-auth" },
  },
  {
    name: "SCIM attribute",
    schema: SCIMAttributeSchema,
    value: { type: "string", name: "userName" },
  },
  {
    name: "executor",
    schema: ExecutorSchema,
    value: {
      name: "my-executor",
      trigger: { kind: "schedule", cron: "0 12 * * *" },
      operation: { kind: "function", body: () => {} },
    },
  },
  {
    name: "IdP",
    schema: IdPSchema,
    value: { name: "my-idp", authorization: "loggedIn", clients: ["default-client"] },
  },
  {
    name: "resolver",
    schema: ResolverSchema,
    value: {
      operation: "query",
      name: "getUser",
      body: () => {},
      output: { type: "string", metadata: {}, fields: {} },
    },
  },
  {
    name: "secrets",
    schema: SecretsSchema,
    value: {
      vaults: { "my-vault": { secret: "value" } },
      options: { ignoreNullishValues: true },
    },
  },
  {
    name: "static website",
    schema: StaticWebsiteSchema,
    value: { name: "my-site" },
  },
  {
    name: "TailorDB service config",
    schema: TailorDBServiceConfigSchema,
    value: { files: ["tailordb/*.ts"] },
  },
  {
    name: "TailorDB type",
    schema: TailorDBTypeSchema,
    value: {
      name: "User",
      fields: {},
      metadata: {
        name: "User",
        permissions: {},
        files: {},
      },
    },
  },
  {
    name: "workflow",
    schema: WorkflowSchema,
    value: {
      name: "my-workflow",
      mainJob: {
        name: "main",
        trigger: () => {},
        body: () => {},
      },
    },
  },
];

describe("parser schemas", () => {
  test.each(strictSchemaCases)("rejects unknown keys for $name", ({ schema, value }) => {
    const result = schema.safeParse({ ...value, unknownOption: true });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected schema parsing to fail");
    }
    expect(hasUnrecognizedKeyIssue(result.error.issues)).toBe(true);
  });

  test("preserves plugin instance properties", () => {
    const result = PluginConfigSchema.safeParse({
      id: "plugin",
      description: "Plugin",
      customProperty: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected plugin config parsing to succeed");
    }
    expect(result.data).toHaveProperty("customProperty", true);
  });

  test("accepts field builder properties", () => {
    const result = TailorFieldSchema.safeParse({
      type: "string",
      metadata: {
        validate: [() => true, [() => true, "Invalid value"]],
      },
      fields: {},
      builderProperty: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected field parsing to succeed");
    }
  });
});
