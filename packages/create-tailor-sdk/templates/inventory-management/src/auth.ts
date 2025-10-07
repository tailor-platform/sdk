import { defineAuth } from "@tailor-platform/tailor-sdk";
import { user } from "./db/user";

export const auth = defineAuth("main-auth", {
  userProfile: {
    type: user,
    usernameField: "email",
    attributes: {
      role: true,
    },
  },
  machineUsers: {
    manager: {
      attributes: { role: "MANAGER" },
    },
    staff: {
      attributes: { role: "STAFF" },
    },
  },
});
