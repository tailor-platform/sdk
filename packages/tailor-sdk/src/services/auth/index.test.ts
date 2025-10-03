import { describe, it, expectTypeOf } from "vitest";

import { defineAuth } from "./index";
import type { AuthServiceInput } from "./types";
import { db } from "../tailordb/schema";

const userType = db.type("User", {
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

const attributeMapConfig: AttributeMap = {
  role: true,
  isActive: true,
  tags: true,
  externalId: true,
};

const attributeListConfig: AttributeList = ["externalId"];
const machineUserAttributeList: [string] = ["admin-external-id"];

type AuthInput = AuthServiceInput<typeof userType, AttributeMap, AttributeList>;

type MachineUserConfig = NonNullable<AuthInput["machineUsers"]>[string];

describe("defineAuth", () => {
  it("machineUsers reflects userProfile attribute typing", () => {
    const validInput = {
      userProfile: {
        type: userType,
        usernameField: "email",
        attributes: attributeMapConfig,
        attributeList: attributeListConfig,
      },
      machineUsers: {
        admin: {
          attributes: {
            role: "ADMIN",
            isActive: true,
            tags: ["root"],
            externalId: "admin-external-id",
          },
          attributeList: machineUserAttributeList,
        },
      },
    } satisfies AuthInput;

    void defineAuth("test", validInput);

    expectTypeOf<MachineUserConfig["attributes"]>().toMatchTypeOf<{
      role: string;
      isActive: boolean;
      tags: string[];
      externalId: string;
    }>();

    expectTypeOf<MachineUserConfig["attributeList"]>().toEqualTypeOf<
      [string]
    >();
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
