import { randomUUID } from "node:crypto";
import { describe, it, expect, expectTypeOf } from "vitest";
import { db } from "../tailordb/schema";
import { defineAuth } from "./index";

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
const machineUserAttributeList: [string] = [randomUUID()];

describe("defineAuth", () => {
  it("creates auth configuration with userProfile and machineUsers", () => {
    const authConfig = defineAuth("test", {
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
    });

    expect(authConfig.name).toBe("test");
    expect(authConfig.userProfile?.type).toBe(userType);
    expect(authConfig.userProfile?.usernameField).toBe("email");
    expect(authConfig.machineUsers?.admin.attributes?.role).toBe("ADMIN");
  });

  it("creates auth configuration with invoker method", () => {
    const authConfig = defineAuth("test-service", {
      userProfile: {
        type: userType,
        usernameField: "email",
      },
      machineUsers: {
        admin: {},
        worker: {},
      },
    });

    const invoker = authConfig.invoker("admin");
    expect(invoker.authName).toBe("test-service");
    expect(invoker.machineUser).toBe("admin");

    const workerInvoker = authConfig.invoker("worker");
    expect(workerInvoker.authName).toBe("test-service");
    expect(workerInvoker.machineUser).toBe("worker");
  });

  it("creates minimal auth configuration", () => {
    const authConfig = defineAuth("minimal", {
      userProfile: {
        type: userType,
        usernameField: "email",
      },
    });

    expect(authConfig.name).toBe("minimal");
    expect(authConfig.userProfile?.type).toBe(userType);
    expect(authConfig.machineUsers).toBeUndefined();
  });

  describe("name literal type inference", () => {
    it("infers name as literal type", () => {
      const authConfig = defineAuth("my-auth-service", {
        userProfile: {
          type: userType,
          usernameField: "email",
        },
      });

      expectTypeOf(authConfig.name).toEqualTypeOf<"my-auth-service">();
    });

    it("preserves name literal in readonly object", () => {
      const _authConfig = defineAuth("production-auth", {
        userProfile: {
          type: userType,
          usernameField: "email",
        },
        machineUsers: {
          admin: {},
        },
      });

      // The entire config should be readonly
      type AuthConfigType = typeof _authConfig;
      expectTypeOf<AuthConfigType>().toMatchObjectType<{
        readonly name: "production-auth";
      }>();
    });

    it("name type is available for type extraction", () => {
      const _authConfig = defineAuth("typed-auth", {
        userProfile: {
          type: userType,
          usernameField: "email",
        },
      });

      type ExtractedName = typeof _authConfig.name;
      expectTypeOf<ExtractedName>().toEqualTypeOf<"typed-auth">();
    });
  });
});
