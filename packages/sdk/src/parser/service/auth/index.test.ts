import * as v from "valibot";
import { describe, expectTypeOf, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { t } from "#/configure/types/type";
import { brandValue } from "#/utils/brand";
import { AuthConfigSchema, OAuth2ClientSchema } from "./schema";
import type { AuthServiceInput } from "#/configure/services/auth/types";
import type { TailorDBInstance } from "#/configure/services/tailordb/types";
import type { OptionalKeysOf } from "type-fest";

// Define userType for type inference
const userType = db.table("User", {
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
type AuthSchemaInput = Omit<v.InferInput<typeof AuthConfigSchema>, "name">;
type IsUnknown<T> = unknown extends T ? ([keyof T] extends [never] ? true : false) : false;

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
    expectTypeOf<IsUnknown<SchemaUserProfile["type"]>>().toEqualTypeOf<false>();
    expectTypeOf<SchemaUserProfile["type"]>().toExtend<TailorDBInstance>();
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

// Fixture with an optional user field to cover optionality mirroring
const mixedUserType = db.table("MixedUser", {
  email: db.string().unique(),
  role: db.string(),
  nickname: db.string({ optional: true }),
});

type MixedAuthInput = AuthServiceInput<
  typeof mixedUserType,
  { role: true; nickname: true },
  [],
  "worker"
>;
type MixedMachineUser = NonNullable<MixedAuthInput["machineUsers"]>["worker"];

describe("machine user attributes mirror user field optionality", () => {
  test("allows omitting or nullifying keys for optional fields", () => {
    expectTypeOf<{ attributes: { role: string } }>().toExtend<MixedMachineUser>();
    expectTypeOf<{
      attributes: { role: string; nickname: string | null };
    }>().toExtend<MixedMachineUser>();
  });

  test("keeps keys for required fields mandatory", () => {
    expectTypeOf<{ attributes: { nickname: string } }>().not.toExtend<MixedMachineUser>();
    expectTypeOf<Record<never, never>>().not.toExtend<MixedMachineUser>();
  });

  test("makes attributes itself optional when no required keys remain", () => {
    type AllOptionalInput = AuthServiceInput<
      typeof mixedUserType,
      { nickname: true },
      [],
      "worker"
    >;
    type AllOptionalMachineUser = NonNullable<AllOptionalInput["machineUsers"]>["worker"];

    expectTypeOf<Record<never, never>>().toExtend<AllOptionalMachineUser>();
  });

  test("still rejects attributes not declared in userProfile", () => {
    expectTypeOf<NonNullable<MixedMachineUser["attributes"]> & { email: string }>().toBeNever();
  });
});

describe("AuthConfigSchema machine user attribute normalization", () => {
  test("drops null/undefined attribute values on parse", () => {
    const config = {
      name: "my-auth",
      userProfile: {
        type: userType,
        usernameField: "email",
        attributes: { role: true, isActive: true, tags: true },
      },
      machineUsers: {
        admin: { attributes: { role: "ADMIN", isActive: null, tags: undefined } },
      },
    };

    const result = v.parse(AuthConfigSchema, config);
    expect(result.machineUsers?.admin?.attributes).toEqual({ role: "ADMIN" });
  });

  test("accepts machine users without attributes", () => {
    const config = {
      name: "my-auth",
      userProfile: { type: userType, usernameField: "email" },
      machineUsers: { admin: {} },
    };

    const result = v.parse(AuthConfigSchema, config);
    expect(result.machineUsers?.admin?.attributes).toBeUndefined();
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

    expect(() => v.parse(OAuth2ClientSchema, validClient)).not.toThrow();
  });

  test.each([
    ["valid", 3600, 86400],
    ["minimum", 60, 60],
    ["maximum", 86400, 604800],
  ])(
    "accepts %s token lifetime values and transforms to Duration",
    (_label, accessTokenLifetimeSeconds, refreshTokenLifetimeSeconds) => {
      const client = {
        redirectURIs: ["https://example.com/callback"],
        accessTokenLifetimeSeconds,
        refreshTokenLifetimeSeconds,
      };

      const result = v.parse(OAuth2ClientSchema, client);
      expect(result.accessTokenLifetimeSeconds).toEqual({
        seconds: BigInt(accessTokenLifetimeSeconds),
        nanos: 0,
      });
      expect(result.refreshTokenLifetimeSeconds).toEqual({
        seconds: BigInt(refreshTokenLifetimeSeconds),
        nanos: 0,
      });
    },
  );

  test.each([
    ["access", "accessTokenLifetimeSeconds", 59, /Minimum access token lifetime is 60 seconds/],
    ["access", "accessTokenLifetimeSeconds", 86401, /Maximum access token lifetime is 1 day/],
    ["refresh", "refreshTokenLifetimeSeconds", 59, /Minimum refresh token lifetime is 60 seconds/],
    ["refresh", "refreshTokenLifetimeSeconds", 604801, /Maximum refresh token lifetime is 7 days/],
  ] as const)("rejects %s token lifetime out of bounds (%s = %d)", (_kind, field, value, error) => {
    const invalidClient = {
      redirectURIs: ["https://example.com/callback"],
      [field]: value,
    };

    expect(() => v.parse(OAuth2ClientSchema, invalidClient)).toThrow(error);
  });

  test("rejects non-integer token lifetime values", () => {
    const invalidClient = {
      redirectURIs: ["https://example.com/callback"],
      accessTokenLifetimeSeconds: 3600.5,
    };

    expect(() => v.parse(OAuth2ClientSchema, invalidClient)).toThrow(/Invalid integer/);
  });

  test("accepts client without token lifetime fields", () => {
    const clientWithoutLifetimes = {
      redirectURIs: ["https://example.com/callback"],
      grantTypes: ["authorization_code", "refresh_token"],
    };

    const result = v.parse(OAuth2ClientSchema, clientWithoutLifetimes);
    expect(result.accessTokenLifetimeSeconds).toBeUndefined();
    expect(result.refreshTokenLifetimeSeconds).toBeUndefined();
  });

  test.each([
    ["true", true, true],
    ["false", false, false],
    ["unset", undefined, undefined],
  ] as const)("accepts requireDpop set to %s", (_label, input, expected) => {
    const client = {
      redirectURIs: ["https://example.com/callback"],
      ...(input === undefined ? {} : { requireDpop: input }),
    };

    const result = v.parse(OAuth2ClientSchema, client);
    expect(result.requireDpop).toBe(expected);
  });

  test("rejects requireDpop=true for browser client type", () => {
    const browserClientWithDpop = {
      redirectURIs: ["https://example.com/callback"],
      clientType: "browser",
      requireDpop: true,
    };

    expect(() => v.parse(OAuth2ClientSchema, browserClientWithDpop)).toThrow(
      /requireDpop cannot be set to true for browser clients/,
    );
  });

  test.each([
    [false, "browser"],
    [true, "confidential"],
    [true, "public"],
  ] as const)("accepts requireDpop=%s for %s client type", (requireDpop, clientType) => {
    const client = {
      redirectURIs: ["https://example.com/callback"],
      clientType,
      requireDpop,
    };

    const result = v.parse(OAuth2ClientSchema, client);
    expect(result.clientType).toBe(clientType);
    expect(result.requireDpop).toBe(requireDpop);
  });
});

describe("AuthConfigSchema publishSessionEvents validation", () => {
  test.each([
    ["true", true, true],
    ["false", false, false],
    ["unset", undefined, undefined],
  ] as const)("accepts publishSessionEvents set to %s", (_label, input, expected) => {
    const config = {
      name: "my-auth",
      ...(input === undefined ? {} : { publishSessionEvents: input }),
    };

    const result = v.parse(AuthConfigSchema, config);
    expect(result.publishSessionEvents).toBe(expected);
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

    expect(() => v.parse(AuthConfigSchema, config)).toThrow(
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

    const result = v.parse(AuthConfigSchema, config);
    expect(result.userProfile?.namespace).toBe("external-ns");
  });

  test("strips TailorDB type builder helpers from userProfile.type", () => {
    const result = v.parse(AuthConfigSchema, {
      name: "my-auth",
      userProfile: {
        type: userType,
        usernameField: "email",
      },
    });

    expect(result.userProfile?.type).toMatchObject({
      name: "User",
      fields: expect.any(Object),
    });
    expect(result.userProfile?.type).not.toHaveProperty("hooks");
    expect(result.userProfile?.type).not.toHaveProperty("_output");
  });

  test("rejects unbranded userProfile.type copies with unknown keys", () => {
    const result = v.safeParse(AuthConfigSchema, {
      name: "my-auth",
      userProfile: {
        type: { ...userType, unknownOption: true },
        usernameField: "email",
      },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected AuthConfigSchema parsing to fail");
    }
    expect(JSON.stringify(result.issues)).toContain("unknownOption");
  });

  test("omits unknown outer userProfile.type keys with TailorDB builder helpers", () => {
    const typeWithUnknownKey = brandValue(
      {
        ...userType,
        unknownOption: true,
      },
      "tailordb-type",
    );

    const result = v.parse(AuthConfigSchema, {
      name: "my-auth",
      userProfile: {
        type: typeWithUnknownKey,
        usernameField: "email",
      },
    });

    expect(result.userProfile?.type).not.toHaveProperty("unknownOption");
  });

  test("rejects invalid TailorDB fields in userProfile.type", () => {
    const typeWithInvalidField = brandValue(
      {
        ...userType,
        fields: {
          ...userType.fields,
          unsupported: {
            type: "unsupported",
            metadata: {},
          },
        },
      },
      "tailordb-type",
    );

    const result = v.safeParse(AuthConfigSchema, {
      name: "my-auth",
      userProfile: {
        type: typeWithInvalidField,
        usernameField: "email",
      },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected AuthConfigSchema parsing to fail");
    }
    expect(JSON.stringify(result.issues)).toContain("unsupported");
  });
});
