import {
  defineAuth,
  defineConfig,
  defineIdp,
  t,
  unsafeAllowAllIdPPermission,
} from "@tailor-platform/sdk";

const staffIdp = defineIdp("staff-idp", {
  clients: ["staff-portal"],
  permission: unsafeAllowAllIdPPermission,
});

const customerIdp = defineIdp("customer-idp", {
  clients: ["customer-app"],
  permission: unsafeAllowAllIdPPermission,
});

export const auth = defineAuth("my-auth", {
  machineUserAttributes: {
    role: t.string(),
  },
  machineUsers: {
    runner: {
      attributes: {
        role: "RUNNER",
      },
    },
  },
  idProvider: staffIdp.provider("primary", "staff-portal"),
});

export default defineConfig({
  name: "micro-challenge",
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
  idp: [staffIdp, customerIdp],
  auth,
});
