import { createResolver, defineAuth, t } from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

// Auth configuration with attributes and attributeList
export const auth = defineAuth("my-auth", {
  userProfile: {
    type: user,
    usernameField: "email",
    attributes: {
      role: true,
      department: true,
    },
    attributeList: ["groupId"],
  },
  machineUsers: {
    "admin-machine-user": {
      attributes: {
        role: "ADMIN",
      },
    },
    "manager-machine-user": {
      attributes: {
        role: "MANAGER",
        department: "sales",
      },
    },
  },
});

// Resolver accessing context.user.attributes
export const userInfo = createResolver({
  name: "showUserInfo",
  operation: "query",
  body: (context) => {
    const role = context.user.attributes?.role ?? "STAFF";
    const groups = context.user.attributeList;
    return {
      id: context.user.id,
      role,
      groups,
    };
  },
  output: t.object({
    id: t.string(),
    role: t.string(),
    groups: t.string({ array: true }),
  }),
});
