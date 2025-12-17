import { describe, it, expectTypeOf, expect } from "vitest";
import { db } from "@/configure/services/tailordb/schema";
import { OAuth2ClientSchema } from "./schema";
import type { AuthConfigSchema } from "./schema";
import type { AuthServiceInput } from "./types";
import type { OptionalKeysOf } from "type-fest";
import type { z } from "zod";

// Define userType for type inference
const _userType = db.type("User", {
  email: db.string().unique(),
  role: db.string(),
  isActive: db.bool(),
  tags: db.string({ array: true }),
  externalId: db.uuid(),
});

type AttributeMap = {
  role: true;
  isActive: true;
  tags: true;
  externalId: true;
};

type AttributeList = ["externalId"];

type AuthInput = AuthServiceInput<
  typeof _userType,
  AttributeMap,
  AttributeList,
  "admin"
>;

type MachineUserConfig = NonNullable<AuthInput["machineUsers"]>["admin"];
type AuthSchemaInput = Omit<z.input<typeof AuthConfigSchema>, "name">;

describe("AuthServiceInput and AuthConfigSchema type alignment", () => {
  it("aligns top-level keys and optionality with the schema", () => {
    type ServiceOptionalKeys = OptionalKeysOf<AuthInput>;
    type SchemaOptionalKeys = OptionalKeysOf<AuthSchemaInput>;

    expectTypeOf<ServiceOptionalKeys>().toEqualTypeOf<SchemaOptionalKeys>();

    type ServiceRequiredKeys = Exclude<keyof AuthInput, ServiceOptionalKeys>;
    type SchemaRequiredKeys = Exclude<
      keyof AuthSchemaInput,
      SchemaOptionalKeys
    >;

    expectTypeOf<ServiceRequiredKeys>().toEqualTypeOf<SchemaRequiredKeys>();
    expectTypeOf<keyof AuthInput>().toEqualTypeOf<keyof AuthSchemaInput>();
  });

  it("aligns AuthServiceInput and schema (except userProfile and machineUsers)", () => {
    type FunctionInput = Omit<AuthInput, "userProfile" | "machineUsers">;
    type SchemaInput = Omit<AuthSchemaInput, "userProfile" | "machineUsers">;

    expectTypeOf<FunctionInput>().toExtend<SchemaInput>();
  });

  it("aligns particular userProfile with the schema", () => {
    type ServiceUserProfile = NonNullable<AuthInput["userProfile"]>;
    type SchemaUserProfile = NonNullable<AuthSchemaInput["userProfile"]>;

    type ServiceAttributes = NonNullable<ServiceUserProfile["attributes"]>;
    type SchemaAttributes = NonNullable<SchemaUserProfile["attributes"]>;

    type AlignedSchemaAttributes = Pick<
      SchemaAttributes,
      keyof ServiceAttributes
    >;

    expectTypeOf<ServiceAttributes>().toMatchObjectType<AlignedSchemaAttributes>();
    expectTypeOf<ServiceUserProfile["type"]>().toExtend<
      SchemaUserProfile["type"]
    >();
    expectTypeOf<ServiceUserProfile["usernameField"]>().toExtend<
      SchemaUserProfile["usernameField"]
    >();
    expectTypeOf<ServiceUserProfile["attributeList"]>().toExtend<
      SchemaUserProfile["attributeList"]
    >();
  });

  it("aligns particular machineUsers with the schema", () => {
    type SchemaMachineUser = NonNullable<
      AuthSchemaInput["machineUsers"]
    >[string];
    type SchemaAttributes = NonNullable<SchemaMachineUser["attributes"]>;
    type SchemaAttributeValue = SchemaAttributes[keyof SchemaAttributes];
    type SchemaAttributeList = SchemaMachineUser["attributeList"];

    type FunctionMachineUser = MachineUserConfig;
    type FunctionAttributeKeys = keyof AttributeMap;
    type FunctionAttributeValues =
      FunctionMachineUser["attributes"][FunctionAttributeKeys];
    type FunctionAttributeList = FunctionMachineUser["attributeList"];

    expectTypeOf<FunctionAttributeValues>().toExtend<SchemaAttributeValue>();
    expectTypeOf<FunctionAttributeList>().toExtend<SchemaAttributeList>();
    expectTypeOf<undefined>().not.toExtend<FunctionMachineUser["attributes"]>();
  });

  it("machineUsers reflects userProfile attribute typing", () => {
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

  it("rejects attributes not declared in userProfile", () => {
    expectTypeOf<
      MachineUserConfig["attributes"] & { email: string }
    >().toBeNever();
  });

  it("rejects attributeList value mismatches", () => {
    expectTypeOf<
      MachineUserConfig["attributeList"] & [string, boolean]
    >().toBeNever();
  });
});

describe("OAuth2ClientSchema validation", () => {
  it("accepts valid OAuth2 client configuration", () => {
    const validClient = {
      redirectURIs: ["https://example.com/callback"],
      grantTypes: ["authorization_code", "refresh_token"],
      description: "Test client",
      clientType: "confidential",
    };

    expect(() => OAuth2ClientSchema.parse(validClient)).not.toThrow();
  });

  it("accepts valid token lifetime values", () => {
    const clientWithLifetimes = {
      redirectURIs: ["https://example.com/callback"],
      accessTokenLifetimeSeconds: 3600,
      refreshTokenLifetimeSeconds: 86400,
    };

    const result = OAuth2ClientSchema.parse(clientWithLifetimes);
    expect(result.accessTokenLifetimeSeconds).toBe(3600);
    expect(result.refreshTokenLifetimeSeconds).toBe(86400);
  });

  it("accepts minimum token lifetime values", () => {
    const clientWithMinLifetimes = {
      redirectURIs: ["https://example.com/callback"],
      accessTokenLifetimeSeconds: 60,
      refreshTokenLifetimeSeconds: 60,
    };

    const result = OAuth2ClientSchema.parse(clientWithMinLifetimes);
    expect(result.accessTokenLifetimeSeconds).toBe(60);
    expect(result.refreshTokenLifetimeSeconds).toBe(60);
  });

  it("accepts maximum token lifetime values", () => {
    const clientWithMaxLifetimes = {
      redirectURIs: ["https://example.com/callback"],
      accessTokenLifetimeSeconds: 86400, // 1 day
      refreshTokenLifetimeSeconds: 604800, // 7 days
    };

    const result = OAuth2ClientSchema.parse(clientWithMaxLifetimes);
    expect(result.accessTokenLifetimeSeconds).toBe(86400);
    expect(result.refreshTokenLifetimeSeconds).toBe(604800);
  });

  it("rejects access token lifetime below minimum", () => {
    const invalidClient = {
      redirectURIs: ["https://example.com/callback"],
      accessTokenLifetimeSeconds: 59,
    };

    expect(() => OAuth2ClientSchema.parse(invalidClient)).toThrow(
      /Minimum access token lifetime is 60 seconds/,
    );
  });

  it("rejects access token lifetime above maximum", () => {
    const invalidClient = {
      redirectURIs: ["https://example.com/callback"],
      accessTokenLifetimeSeconds: 86401,
    };

    expect(() => OAuth2ClientSchema.parse(invalidClient)).toThrow(
      /Maximum access token lifetime is 1 day/,
    );
  });

  it("rejects refresh token lifetime below minimum", () => {
    const invalidClient = {
      redirectURIs: ["https://example.com/callback"],
      refreshTokenLifetimeSeconds: 59,
    };

    expect(() => OAuth2ClientSchema.parse(invalidClient)).toThrow(
      /Minimum refresh token lifetime is 60 seconds/,
    );
  });

  it("rejects refresh token lifetime above maximum", () => {
    const invalidClient = {
      redirectURIs: ["https://example.com/callback"],
      refreshTokenLifetimeSeconds: 604801,
    };

    expect(() => OAuth2ClientSchema.parse(invalidClient)).toThrow(
      /Maximum refresh token lifetime is 7 days/,
    );
  });

  it("rejects non-integer token lifetime values", () => {
    const invalidClient = {
      redirectURIs: ["https://example.com/callback"],
      accessTokenLifetimeSeconds: 3600.5,
    };

    expect(() => OAuth2ClientSchema.parse(invalidClient)).toThrow();
  });

  it("accepts client without token lifetime fields", () => {
    const clientWithoutLifetimes = {
      redirectURIs: ["https://example.com/callback"],
      grantTypes: ["authorization_code", "refresh_token"],
    };

    const result = OAuth2ClientSchema.parse(clientWithoutLifetimes);
    expect(result.accessTokenLifetimeSeconds).toBeUndefined();
    expect(result.refreshTokenLifetimeSeconds).toBeUndefined();
  });
});
