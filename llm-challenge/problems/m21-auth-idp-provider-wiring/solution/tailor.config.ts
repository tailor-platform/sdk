import {
  defineAuth,
  defineConfig,
  defineIdp,
  t,
  unsafeAllowAllIdPPermission,
} from "@tailor-platform/sdk";

const idp = defineIdp("my-idp", {
  clients: ["default-idp-client"],
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
  idProvider: idp.provider("primary", "default-idp-client"),
});

export default defineConfig({
  name: "micro-challenge",
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
  idp: [idp],
  auth,
});
