import { defineAuth } from "@tailor-platform/tailor-sdk";
import { user } from "./tailordb/user";

export const auth = defineAuth("my-auth", {
  userProfile: {
    type: user,
    usernameField: "email",
    attributes: {
      role: true,
    },
  },
  machineUsers: {
    "admin-machine-user": {
      attributes: {
        role: "ADMIN",
      },
    },
  },
  oauth2Clients: {
    sample: {
      redirectURIs: [
        "https://example.com/callback",
        "my-frontend:url/callback",
      ],
      description: "Sample OAuth2 client",
      grantTypes: ["authorization_code", "refresh_token"],
    },
  },
  idProvider: {
    name: "sample",
    kind: "BuiltInIdP",
    namespace: "my-idp",
    clientName: "default-idp-client",
  },
});
