import { describe, expect, test, vi } from "vitest";
import { assertEnvHasNoSecrets, resolveEnvValue, scanEnvForSecrets } from "./env-secret-scan";
import { logger } from "./logger";

// Assembled at runtime: spelled out in full, these fixtures are indistinguishable
// from live credentials to the repository's own push protection, which rejects
// the commit before it can be pushed.
const SLACK_TOKEN = ["xoxb", "123456789012", "1234567890123", "AbCdEfGhIjKlMnOpQrStUvWx"].join("-");
const GITHUB_TOKEN = ["ghp", "16C7e42F292c6912E7710c838347Ae178B4a"].join("_");
const AWS_ACCESS_KEY_ID = ["AKIA", "QYLPMN5HGZQ4WXYZ"].join("");
const AWS_SECRET = ["kR8xNvPq2LmT7wYbZc3JdFgHs", "A1eU5oI9pQrStVw"].join("");

async function captureFailure(scan: Promise<void>): Promise<Error> {
  try {
    await scan;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the scan to fail, but it passed");
}

describe("scanEnvForSecrets", () => {
  test("reports a provider match as an error naming the env key", async () => {
    const findings = await scanEnvForSecrets({ env: { SLACK_BOT_TOKEN: SLACK_TOKEN } });

    expect(findings).toEqual([
      {
        key: "SLACK_BOT_TOKEN",
        detector: "slack",
        rule: "SLACK_TOKEN",
        docsUrl: expect.stringContaining("secretlint-rule-slack"),
        severity: "error",
      },
    ]);
  });

  test("detects an AWS access key id, which the provider rule set skips by default", async () => {
    const findings = await scanEnvForSecrets({ env: { AWS_ACCESS_KEY_ID } });

    expect(findings).toEqual([
      expect.objectContaining({
        key: "AWS_ACCESS_KEY_ID",
        detector: "aws",
        rule: "AWSAccessKeyID",
        severity: "error",
      }),
    ]);
  });

  test("detects a secret whose rule needs the key name for context", async () => {
    const findings = await scanEnvForSecrets({ env: { AWS_SECRET_ACCESS_KEY: AWS_SECRET } });

    expect(findings).toContainEqual(
      expect.objectContaining({
        key: "AWS_SECRET_ACCESS_KEY",
        detector: "aws",
        rule: "AWSSecretAccessKey",
        severity: "error",
      }),
    );
  });

  test("distinguishes the AWS patterns the one detector covers", async () => {
    const [accountId] = await scanEnvForSecrets({ env: { AWS_ACCOUNT_ID: 123456789012 } });
    const [accessKeyId] = await scanEnvForSecrets({ env: { AWS_ACCESS_KEY_ID } });

    expect(accountId?.detector).toBe(accessKeyId?.detector);
    expect(accountId?.rule).toBe("AWSAccountID");
    expect(accessKeyId?.rule).toBe("AWSAccessKeyID");
  });

  test("attributes a match inside a multi-line value to the right key", async () => {
    const findings = await scanEnvForSecrets({
      env: {
        BANNER: `line one\nline two\n${GITHUB_TOKEN}`,
        TRAILING: "https://api.example.com/v1",
      },
    });

    expect(findings).toEqual([
      expect.objectContaining({ key: "BANNER", detector: "github", rule: "GITHUB_TOKEN" }),
    ]);
  });

  test("leaves ordinary configuration values alone", async () => {
    const findings = await scanEnvForSecrets({
      env: {
        API_BASE: "https://api.example.com/v1/graphql",
        APP_ID: "d0a3398a-f79c-4c2e-be1e-b81469bb0a43",
        COMMIT: "9f2b7c1d4e6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c",
        TENANT: "acme-corp-production-tenant",
        IMAGE: "registry.example.com/team/app:1.2.3-alpha.4",
        RETRIES: 3,
        VERBOSE: true,
      },
    });

    expect(findings).toEqual([]);
  });

  test("reports an unrecognized but random-looking value as a warning", async () => {
    const findings = await scanEnvForSecrets({
      env: { LEGACY_TOKEN: "Zk3xQ9pLmVn7WcT2bYr5JdHgSaEuIoPq8FvNzXwCkMj4" },
    });

    expect(findings).toEqual([
      { key: "LEGACY_TOKEN", detector: "high-entropy", severity: "warning" },
    ]);
    expect(findings[0]?.rule).toBeUndefined();
  });

  test("does not add an entropy warning for a value a provider rule already matched", async () => {
    const findings = await scanEnvForSecrets({ env: { SLACK_BOT_TOKEN: SLACK_TOKEN } });

    expect(findings.filter((finding) => finding.severity === "warning")).toEqual([]);
  });

  test("skips an entry that allows its own secret", async () => {
    const findings = await scanEnvForSecrets({
      env: {
        SLACK_BOT_TOKEN: {
          value: SLACK_TOKEN,
          allowSecretReason: "public webhook for a demo workspace",
        },
      },
    });

    expect(findings).toEqual([]);
  });

  test("keeps scanning the entries around an allowed one", async () => {
    const findings = await scanEnvForSecrets({
      env: {
        ALLOWED: { value: SLACK_TOKEN, allowSecretReason: "demo workspace" },
        LEAKED: GITHUB_TOKEN,
      },
    });

    expect(findings).toEqual([
      expect.objectContaining({ key: "LEAKED", detector: "github", rule: "GITHUB_TOKEN" }),
    ]);
  });

  test("flags a numeric AWS account id, so numbers still need an allowance", async () => {
    const findings = await scanEnvForSecrets({ env: { AWS_ACCOUNT_ID: 123456789012 } });

    expect(findings).toEqual([
      expect.objectContaining({ key: "AWS_ACCOUNT_ID", detector: "aws", rule: "AWSAccountID" }),
    ]);
    expect(
      await scanEnvForSecrets({
        env: { AWS_ACCOUNT_ID: { value: 123456789012, allowSecretReason: "public account id" } },
      }),
    ).toEqual([]);
  });

  test("never flags a boolean, whatever the key is called", async () => {
    const findings = await scanEnvForSecrets({
      env: { AWS_SECRET_ACCESS_KEY: true, SLACK_BOT_TOKEN: false },
    });

    expect(findings).toEqual([]);
  });

  test("returns nothing when env is absent or empty", async () => {
    expect(await scanEnvForSecrets({})).toEqual([]);
    expect(await scanEnvForSecrets({ env: {} })).toEqual([]);
  });
});

describe("assertEnvHasNoSecrets", () => {
  test("fails naming the key and the detector, and pointing at Secret Manager", async () => {
    const error = await captureFailure(
      assertEnvHasNoSecrets({ env: { SLACK_BOT_TOKEN: SLACK_TOKEN } }),
    );

    expect(error.message).toContain("env.SLACK_BOT_TOKEN (matched slack: SLACK_TOKEN)");
    expect(error.message).toContain("secretlint-rule-slack/README.md#SLACK_TOKEN");
    expect(error.message).toContain("defineSecretManager()");
    expect(error.message).toContain(
      'SLACK_BOT_TOKEN: { value: ..., allowSecretReason: "<why this is safe>" }',
    );
  });

  test("never repeats the detected value", async () => {
    const error = await captureFailure(
      assertEnvHasNoSecrets({ env: { SLACK_BOT_TOKEN: SLACK_TOKEN } }),
    );

    expect(error.message).not.toContain(SLACK_TOKEN);
  });

  test("warns without failing when only the entropy heuristic matched", async () => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(
      assertEnvHasNoSecrets({
        env: { LEGACY_TOKEN: "Zk3xQ9pLmVn7WcT2bYr5JdHgSaEuIoPq8FvNzXwCkMj4" },
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("env.LEGACY_TOKEN");
  });

  test("names the config the entries came from", async () => {
    const error = await captureFailure(
      assertEnvHasNoSecrets({
        env: { SLACK_BOT_TOKEN: SLACK_TOKEN },
        configPath: "/project/tailor.config.ts",
      }),
    );

    expect(error.message).toContain("Secret detected in 'env' in /project/tailor.config.ts");
  });

  test("warns once when the same entries are scanned repeatedly", async () => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const input = {
      env: { REPEATED_TOKEN: "Zk3xQ9pLmVn7WcT2bYr5JdHgSaEuIoPq8FvNzXwCkMj4" },
      configPath: "/project/repeated.config.ts",
    };

    await assertEnvHasNoSecrets(input);
    await assertEnvHasNoSecrets({ ...input });

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test("passes for an application without env", async () => {
    await expect(assertEnvHasNoSecrets({})).resolves.toBeUndefined();
  });
});

describe("resolveEnvValue", () => {
  test("passes plain values through and unwraps allowed ones", () => {
    expect(resolveEnvValue("hello")).toBe("hello");
    expect(resolveEnvValue(3)).toBe(3);
    expect(resolveEnvValue(false)).toBe(false);
    expect(resolveEnvValue({ value: SLACK_TOKEN, allowSecretReason: "demo workspace" })).toBe(
      SLACK_TOKEN,
    );
  });
});
