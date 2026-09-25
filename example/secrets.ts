import { defineSecretManager } from "@tailor-platform/sdk";

export const secrets = defineSecretManager({
  "example-secrets": {
    "sample-token": process.env.EXAMPLE_SECRET_TOKEN ?? "example-secret-value",
  },
});
