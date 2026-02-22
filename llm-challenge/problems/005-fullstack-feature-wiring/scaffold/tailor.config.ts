import { defineConfig } from "@tailor-platform/sdk";

// TODO: Build complete configuration with:
// - Static website "registration-app"
// - IDP "registration-idp" with userAuthPolicy
// - Auth "registration-auth" with userProfile, machineUsers, oauth2Clients
// - All service file paths (db, resolver, executor, workflow)
// - CORS with website URL
// - Generators for kysely-type

export default defineConfig({
  name: "challenge-005",
});
