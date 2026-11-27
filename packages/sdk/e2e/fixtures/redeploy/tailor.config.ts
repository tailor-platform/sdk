import { defineAuth, defineConfig } from "@tailor-platform/sdk";
import { tenant } from "./tailordb/tenant";
import { user } from "./tailordb/user";

const auth = defineAuth("redeploy-auth", {
  userProfile: { type: user, usernameField: "email" },
  tenantProvider: { namespace: "redeploy-db", type: tenant.name, signatureField: "signature" },
  connections: {
    "redeploy-connection": {
      type: "oauth2",
      providerUrl: "https://accounts.google.com",
      issuerUrl: "https://accounts.google.com",
      clientId: "redeploy-e2e-client",
      clientSecret: "redeploy-e2e-secret",
    },
  },
});

export default defineConfig({
  id: "7d3c1f0e-5b8a-4e2f-9c61-2a4b8d9e0f13",
  name: "redeploy-drift-e2e",
  auth,
  db: {
    "redeploy-db": { files: ["./tailordb/*.ts"] },
  },
});
