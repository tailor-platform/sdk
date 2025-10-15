import { describe, it, expectTypeOf } from "vitest";
import type { z } from "zod";
import type { OptionalKeysOf } from "type-fest";

import type { AuthServiceInput } from "./types";
import type { AuthConfigSchema } from "./schema";
import { db } from "@/configure/services/tailordb/schema";

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
