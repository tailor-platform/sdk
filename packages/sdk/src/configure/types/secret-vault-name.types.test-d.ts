import { assertType, describe, test } from "vitest";
import type { SecretNameForRegistry } from "./secret-vault-name";

interface TestVaultRegistry {
  "api-keys": "stripe-secret-key" | "sendgrid-api-key";
  database: "analytics-connection-string";
}

describe("SecretNameForRegistry", () => {
  test("accepts a secret name declared for that vault", () => {
    assertType<SecretNameForRegistry<"api-keys", TestVaultRegistry>>("stripe-secret-key");
    assertType<SecretNameForRegistry<"api-keys", TestVaultRegistry>>("sendgrid-api-key");
    assertType<SecretNameForRegistry<"database", TestVaultRegistry>>("analytics-connection-string");
  });

  test("rejects a secret name not declared for that vault", () => {
    // @ts-expect-error "stripe-secret-key" belongs to "api-keys", not "database"
    assertType<SecretNameForRegistry<"database", TestVaultRegistry>>("stripe-secret-key");
    // @ts-expect-error typo'd secret name
    assertType<SecretNameForRegistry<"api-keys", TestVaultRegistry>>("stripe-secret-keyyy");
  });

  test("accepts any secret name for a vault absent from the registry", () => {
    // Not declared via defineSecretManager() -- for example a CLI-managed vault --
    // so its secret names are not checked.
    assertType<SecretNameForRegistry<"cli-managed-vault", TestVaultRegistry>>("anything");
  });
});
