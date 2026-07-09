// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { randomUUID } from "node:crypto";
import { describe, expect, test, expectTypeOf } from "vitest";
import { t } from "#/configure/types/type";
import { db } from "../tailordb/schema";
import { defineAuth } from "./index";
import type {
  BeforeLoginHook,
  BeforeLoginHookArgs,
  FederatedIdentity,
} from "#/configure/services/auth/types";
import type { JsonObject } from "type-fest";

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

const attributeMapConfig: Attributes = {
  role: true,
  isActive: true,
  tags: true,
  externalId: true,
};

const attributeListConfig: AttributeList = ["externalId"];
const machineUserAttributeList: [string] = [randomUUID()];
const basicUserProfile = { type: userType, usernameField: "email" } as const;

describe("defineAuth", () => {
  test("creates auth configuration with userProfile and machineUsers", () => {
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
    expect(authConfig.userProfile.type).toBe(userType);
    expect(authConfig.userProfile.usernameField).toBe("email");
    expect(authConfig.machineUsers?.admin.attributes?.role).toBe("ADMIN");
  });

  test("creates minimal auth configuration", () => {
    const authConfig = defineAuth("minimal", {
      userProfile: basicUserProfile,
    });

    expect(authConfig.name).toBe("minimal");
    expect(authConfig.userProfile.type).toBe(userType);
    expect(authConfig.machineUsers).toBeUndefined();
    expect(authConfig).not.toHaveProperty("getConnectionToken");
    expectTypeOf(authConfig).not.toHaveProperty("getConnectionToken");
  });

  test("creates auth configuration with machineUsers only", () => {
    const authConfig = defineAuth("machine-only", {
      machineUserAttributes: {
        role: t.enum(["ADMIN", "WORKER"]),
        isActive: t.bool(),
        tags: t.string({ array: true }),
        externalId: t.uuid(),
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
        worker: {
          attributes: {
            role: "WORKER",
            isActive: false,
            tags: [],
            externalId: "worker-external-id",
          },
        },
      },
    });

    expect(authConfig.name).toBe("machine-only");
    expect(authConfig.userProfile).toBeUndefined();
    expect(authConfig.machineUsers!.admin.attributes.role).toBe("ADMIN");
    expectTypeOf(authConfig.machineUsers!.admin.attributes.role).toEqualTypeOf<
      "ADMIN" | "WORKER"
    >();
  });

  test("rejects invalid machine user attributes when machineUsers-only", () => {
    defineAuth("machine-only-invalid", {
      machineUserAttributes: {
        role: t.enum(["ADMIN", "WORKER"]),
      },
      machineUsers: {
        admin: {
          attributes: {
            role: "ADMIN",
          },
        },
        worker: {
          attributes: {
            // @ts-expect-error - role only allows "ADMIN" | "WORKER"
            role: "OWNER",
          },
        },
      },
    });
  });

  describe("name literal type inference", () => {
    test("infers name as literal type", () => {
      const authConfig = defineAuth("my-auth-service", {
        userProfile: basicUserProfile,
      });

      expectTypeOf(authConfig.name).toEqualTypeOf<"my-auth-service">();
    });

    test("preserves name literal in readonly object", () => {
      const _authConfig = defineAuth("production-auth", {
        userProfile: basicUserProfile,
        machineUsers: {
          admin: {},
        },
      });

      // The entire config should be readonly
      type AuthConfigType = typeof _authConfig;
      expectTypeOf<AuthConfigType>().toMatchObjectType<{
        name: "production-auth";
      }>();
    });

    test("name type is available for type extraction", () => {
      const _authConfig = defineAuth("typed-auth", {
        userProfile: basicUserProfile,
      });

      type ExtractedName = typeof _authConfig.name;
      expectTypeOf<ExtractedName>().toEqualTypeOf<"typed-auth">();
    });
  });

  describe("beforeLogin hook", () => {
    test("includes beforeLogin in auth config when provided", () => {
      const handler = async (_args: { claims: JsonObject; idpConfigName: string }) => {
        // no return value
      };
      const authConfig = defineAuth("hook-auth", {
        userProfile: basicUserProfile,
        machineUsers: {
          "hook-invoker": {},
        },
        hooks: {
          beforeLogin: {
            handler,
            invoker: "hook-invoker",
          },
        },
      });

      expect(authConfig.hooks!.beforeLogin).toBeDefined();
      expect(authConfig.hooks!.beforeLogin!.handler).toBe(handler);
      expect(authConfig.hooks!.beforeLogin!.invoker).toBe("hook-invoker");
    });

    test("constrains invoker to machine user names at the type level", () => {
      // BeforeLoginHook<MachineUserNames> constrains invoker to MachineUserNames.
      // We verify this structurally rather than via overload resolution (which differs in tsgo).
      type Hook = BeforeLoginHook<"admin" | "worker">;
      expectTypeOf<Hook["invoker"]>().toEqualTypeOf<"admin" | "worker">();
    });

    test("works with multiple machine users without narrowing MachineUserNames", () => {
      const authConfig = defineAuth("multi-mu-hook", {
        userProfile: basicUserProfile,
        machineUsers: {
          admin: {},
          worker: {},
        },
        hooks: {
          beforeLogin: {
            handler: async ({ claims, idpConfigName }) => {
              void claims;
              void idpConfigName;
            },
            invoker: "admin",
          },
        },
      });

      expect(authConfig.hooks!.beforeLogin!.invoker).toBe("admin");
    });

    test("typed claims expose federated_identity while keeping arbitrary claims", () => {
      type Claims = BeforeLoginHookArgs["claims"];

      // federated_identity is optional and shaped as { provider, claims }
      expectTypeOf<Claims["federated_identity"]>().toEqualTypeOf<FederatedIdentity | undefined>();

      // arbitrary IdP claims remain reachable through the JsonObject index signature
      expectTypeOf<Claims["sub"]>().not.toBeNever();

      const claims: Claims = { federated_identity: { provider: "google", claims: {} } };
      expectTypeOf(claims.federated_identity?.provider).toEqualTypeOf<
        "google" | "microsoft" | undefined
      >();
      expectTypeOf(claims.federated_identity?.claims.picture).toEqualTypeOf<string | undefined>();
    });

    test("is optional — existing tests continue to pass without it", () => {
      const authConfig = defineAuth("no-hook", {
        userProfile: basicUserProfile,
      });

      expect(authConfig.hooks).toBeUndefined();
    });
  });
});
