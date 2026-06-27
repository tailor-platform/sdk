import { describe, expectTypeOf, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { t } from "#/configure/types/type";
import { AuthConfigSchema, OAuth2ClientSchema } from "./schema";
import type { AuthServiceInput } from "#/configure/services/auth/types";
import type { OptionalKeysOf } from "type-fest";
import type { z } from "zod";

// Define userType for type inference
const userType = db.type("User", {
  email: db.string().unique(),
  role: db.string(),
  isActive: db.bool(),
  tags: db.string({ array: true }),
  externalId: db.uuid(),
});

type Attributes = {
  role: true;
  isActive: true;
  tags: true;
  externalId: true;
};

type AttributeList = ["externalId"];

type AuthInput = AuthServiceInput<typeof userType, Attributes, AttributeList, "admin">;

type MachineUserConfig = NonNullable<AuthInput["machineUsers"]>["admin"];
type AuthSchemaInput = Omit<z.input<typeof AuthConfigSchema>, "name">;

describe("AuthServiceInput and AuthConfigSchema type alignment", () => {
  test("aligns top-level keys and optionality with the schema", () => {
    type ServiceOptionalKeys = OptionalKeysOf<AuthInput>;
    type SchemaOptionalKeys = OptionalKeysOf<AuthSchemaInput>;

    expectTypeOf<ServiceOptionalKeys>().toEqualTypeOf<SchemaOptionalKeys>();

    type ServiceRequiredKeys = Exclude<keyof AuthInput, ServiceOptionalKeys>;
    type SchemaRequiredKeys = Exclude<keyof AuthSchemaInput, SchemaOptionalKeys>;

    expectTypeOf<ServiceRequiredKeys>().toEqualTypeOf<SchemaRequiredKeys>();
    expectTypeOf<keyof AuthInput>().toEqualTypeOf<keyof AuthSchemaInput>();
  });

  test("aligns AuthServiceInput and schema (except userProfile and machineUsers)", () => {
    type FunctionInput = Omit<AuthInput, "userProfile" | "machineUsers">;
    type SchemaInput = Omit<AuthSchemaInput, "userProfile" | "machineUsers">;

    expectTypeOf<FunctionInput>().toExtend<SchemaInput>();
  });

  test("aligns particular userProfile with the schema", () => {
    type ServiceUserProfile = NonNullable<AuthInput["userProfile"]>;
    type SchemaUserProfile = NonNullable<AuthSchemaInput["userProfile"]>;

    type ServiceAttributes = NonNullable<ServiceUserProfile["attributes"]>;
    type SchemaAttributes = NonNullable<SchemaUserProfile["attributes"]>;

    type AlignedSchemaAttributes = Pick<SchemaAttributes, keyof ServiceAttributes>;

    expectTypeOf<ServiceAttributes>().toMatchObjectType<AlignedSchemaAttributes>();
    expectTypeOf<ServiceUserProfile["type"]>().toExtend<SchemaUserProfile["type"]>();
    expectTypeOf<ServiceUserProfile["usernameField"]>().toExtend<
      SchemaUserProfile["usernameField"]
    >();
    expectTypeOf<ServiceUserProfile["attributeList"]>().toExtend<
      SchemaUserProfile["attributeList"]
    >();
  });

  test("aligns particular machineUsers with the schema", () => {
    type SchemaMachineUser = NonNullable<AuthSchemaInput["machineUsers"]>[string];
    type SchemaAttributes = NonNullable<SchemaMachineUser["attributes"]>;
    type SchemaAttributeValue = SchemaAttributes[keyof SchemaAttributes];
    type SchemaAttributeList = SchemaMachineUser["attributeList"];

    type FunctionMachineUser = MachineUserConfig;
    type FunctionAttributeKeys = keyof Attributes;
    type FunctionAttributeValues = FunctionMachineUser["attributes"][FunctionAttributeKeys];
    type FunctionAttributeList = FunctionMachineUser["attributeList"];

    expectTypeOf<FunctionAttributeValues>().toExtend<SchemaAttributeValue>();
    expectTypeOf<FunctionAttributeList>().toExtend<SchemaAttributeList>();
    expectTypeOf<undefined>().not.toExtend<FunctionMachineUser["attributes"]>();
  });

  test("machineUsers reflects userProfile attribute typing", () => {
    expectTypeOf<MachineUserConfig["attributes"]>().toMatchObjectType<{
      role: string;
      isActive: boolean;
      tags: string[];
      externalId: string;
    }>();

    expectTypeOf<MachineUserConfig>().toMatchObjectType<{
      attributeList: [string];
    }>();
  });

  test("rejects attributes not declared in userProfile", () => {
    expectTypeOf<MachineUserConfig["attributes"] & { email: string }>().toBeNever();
  });

  test("rejects attributeList value mismatches", () => {
    expectTypeOf<MachineUserConfig["attributeList"] & [string, boolean]>().toBeNever();
  });
});

describe("OAuth2ClientSchema validation", () => {
  test("accepts valid OAuth2 client configuration", () => {
    const validClient = {
      redirectURIs: ["https://example.com/callback"],
      grantTypes: ["authorization_code", "refresh_token"],
      description: "Test client",
      clientType: "confidential",
    };

    expect(() => OAuth2ClientSchema.parse(validClient)).not.toThrow();
  });

  test("accepts valid token lifetime values and transforms to Duration", () => {
    const clientWithLifetimes = {
      redirectURIs: ["https://example.com/callback"],
      accessTokenLifetimeSeconds: 3600,
      refreshTokenLifetimeSeconds: 86400,
    };

    const result = OAuth2ClientSchema.parse(clientWithLifetimes);
    expect(result.accessTokenLifetimeSeconds).toEqual({
      seconds: BigInt(3600),
      nanos: 0,
    });
    expect(result.refreshTokenLifetimeSeconds).toEqual({
      seconds: BigInt(86400),
      nanos: 0,
    });
  });

  test("accepts minimum token lifetime values and transforms to Duration", () => {
    const clientWithMinLifetimes = {
      redirectURIs: ["https://example.com/callback"],
      accessTokenLifetimeSeconds: 60,
      refreshTokenLifetimeSeconds: 60,
    };

    const result = OAuth2ClientSchema.parse(clientWithMinLifetimes);
    expect(result.accessTokenLifetimeSeconds).toEqual({
      seconds: BigInt(60),
      nanos: 0,
    });
    expect(result.refreshTokenLifetimeSeconds).toEqual({
      seconds: BigInt(60),
      nanos: 0,
    });
  });

  test("accepts maximum token lifetime values and transforms to Duration", () => {
    const clientWithMaxLifetimes = {
      redirectURIs: ["https://example.com/callback"],
      accessTokenLifetimeSeconds: 86400, // 1 day
      refreshTokenLifetimeSeconds: 604800, // 7 days
    };

    const result = OAuth2ClientSchema.parse(clientWithMaxLifetimes);
    expect(result.accessTokenLifetimeSeconds).toEqual({
      seconds: BigInt(86400),
      nanos: 0,
    });
    expect(result.refreshTokenLifetimeSeconds).toEqual({
      seconds: BigInt(604800),
      nanos: 0,
    });
  });

  test("rejects access token lifetime below minimum", () => {
    const invalidClient = {
      redirectURIs: ["https://example.com/callback"],
      accessTokenLifetimeSeconds: 59,
    };

    expect(() => OAuth2ClientSchema.parse(invalidClient)).toThrow(
      /Minimum access token lifetime is 60 seconds/,
    );
  });

  test("rejects access token lifetime above maximum", () => {
    const invalidClient = {
      redirectURIs: ["https://example.com/callback"],
      accessTokenLifetimeSeconds: 86401,
    };

    expect(() => OAuth2ClientSchema.parse(invalidClient)).toThrow(
      /Maximum access token lifetime is 1 day/,
    );
  });

  test("rejects refresh token lifetime below minimum", () => {
    const invalidClient = {
      redirectURIs: ["https://example.com/callback"],
      refreshTokenLifetimeSeconds: 59,
    };

    expect(() => OAuth2ClientSchema.parse(invalidClient)).toThrow(
      /Minimum refresh token lifetime is 60 seconds/,
    );
  });

  test("rejects refresh token lifetime above maximum", () => {
    const invalidClient = {
      redirectURIs: ["https://example.com/callback"],
      refreshTokenLifetimeSeconds: 604801,
    };

    expect(() => OAuth2ClientSchema.parse(invalidClient)).toThrow(
      /Maximum refresh token lifetime is 7 days/,
    );
  });

  test("rejects non-integer token lifetime values", () => {
    const invalidClient = {
      redirectURIs: ["https://example.com/callback"],
      accessTokenLifetimeSeconds: 3600.5,
    };

    expect(() => OAuth2ClientSchema.parse(invalidClient)).toThrow(/Invalid input/);
  });

  test("accepts client without token lifetime fields", () => {
    const clientWithoutLifetimes = {
      redirectURIs: ["https://example.com/callback"],
      grantTypes: ["authorization_code", "refresh_token"],
    };

    const result = OAuth2ClientSchema.parse(clientWithoutLifetimes);
    expect(result.accessTokenLifetimeSeconds).toBeUndefined();
    expect(result.refreshTokenLifetimeSeconds).toBeUndefined();
  });

  test("accepts requireDpop set to true", () => {
    const clientWithDpop = {
      redirectURIs: ["https://example.com/callback"],
      requireDpop: true,
    };

    const result = OAuth2ClientSchema.parse(clientWithDpop);
    expect(result.requireDpop).toBe(true);
  });

  test("accepts requireDpop set to false", () => {
    const clientWithDpop = {
      redirectURIs: ["https://example.com/callback"],
      requireDpop: false,
    };

    const result = OAuth2ClientSchema.parse(clientWithDpop);
    expect(result.requireDpop).toBe(false);
  });

  test("accepts client without requireDpop field", () => {
    const clientWithoutDpop = {
      redirectURIs: ["https://example.com/callback"],
    };

    const result = OAuth2ClientSchema.parse(clientWithoutDpop);
    expect(result.requireDpop).toBeUndefined();
  });

  test("rejects requireDpop=true for browser client type", () => {
    const browserClientWithDpop = {
      redirectURIs: ["https://example.com/callback"],
      clientType: "browser",
      requireDpop: true,
    };

    expect(() => OAuth2ClientSchema.parse(browserClientWithDpop)).toThrow(
      /requireDpop cannot be set to true for browser clients/,
    );
  });

  test("accepts requireDpop=false for browser client type", () => {
    const browserClientWithoutDpop = {
      redirectURIs: ["https://example.com/callback"],
      clientType: "browser",
      requireDpop: false,
    };

    const result = OAuth2ClientSchema.parse(browserClientWithoutDpop);
    expect(result.clientType).toBe("browser");
    expect(result.requireDpop).toBe(false);
  });

  test("accepts requireDpop=true for confidential client type", () => {
    const confidentialClientWithDpop = {
      redirectURIs: ["https://example.com/callback"],
      clientType: "confidential",
      requireDpop: true,
    };

    const result = OAuth2ClientSchema.parse(confidentialClientWithDpop);
    expect(result.clientType).toBe("confidential");
    expect(result.requireDpop).toBe(true);
  });

  test("accepts requireDpop=true for public client type", () => {
    const publicClientWithDpop = {
      redirectURIs: ["https://example.com/callback"],
      clientType: "public",
      requireDpop: true,
    };

    const result = OAuth2ClientSchema.parse(publicClientWithDpop);
    expect(result.clientType).toBe("public");
    expect(result.requireDpop).toBe(true);
  });
});

describe("AuthConfigSchema publishSessionEvents validation", () => {
  test("accepts publishSessionEvents set to true", () => {
    const config = {
      name: "my-auth",
      publishSessionEvents: true,
    };

    const result = AuthConfigSchema.parse(config);
    expect(result.publishSessionEvents).toBe(true);
  });

  test("accepts publishSessionEvents set to false", () => {
    const config = {
      name: "my-auth",
      publishSessionEvents: false,
    };

    const result = AuthConfigSchema.parse(config);
    expect(result.publishSessionEvents).toBe(false);
  });

  test("accepts config without publishSessionEvents field", () => {
    const config = {
      name: "my-auth",
    };

    const result = AuthConfigSchema.parse(config);
    expect(result.publishSessionEvents).toBeUndefined();
  });
});

describe("AuthConfigSchema userProfile/machineUserAttributes validation", () => {
  test("rejects configs that include both userProfile and machineUserAttributes", () => {
    const config = {
      name: "my-auth",
      userProfile: {
        type: userType,
        usernameField: "email",
      },
      machineUserAttributes: {
        role: t.string(),
      },
    };

    expect(() => AuthConfigSchema.parse(config)).toThrow(
      /Specify either `userProfile` or `machineUserAttributes`, not both/,
    );
  });

  test("preserves an explicit userProfile.namespace", () => {
    const config = {
      name: "my-auth",
      userProfile: {
        namespace: "external-ns",
        type: userType,
        usernameField: "email",
      },
    };

    const result = AuthConfigSchema.parse(config);
    expect(result.userProfile?.namespace).toBe("external-ns");
  });
});
