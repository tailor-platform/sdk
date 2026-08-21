import { CustomDomainStatus } from "@tailor-platform/tailor-proto/staticwebsite_resource_pb";
import { runCommand } from "politty";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { captureStderr, captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { domainListCommand } from "./list";

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
  loadWorkspaceId: vi.fn().mockResolvedValue("mock-workspace-id"),
}));

vi.mock("#/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
}));

function mockCustomDomains(customDomains: unknown[]) {
  vi.mocked(initOperatorClient).mockResolvedValue({
    listCustomDomains: vi.fn().mockResolvedValue({ customDomains }),
  } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
}

describe("staticwebsite domain list", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    await runTest();
  });

  test("prints formatted domains in JSON mode", async () => {
    mockCustomDomains([
      {
        domain: "www.example.com",
        status: CustomDomainStatus.ACTIVE,
        trafficCnameTarget: "traffic.example.net",
        certificateCnameTarget: "cert.example.net",
      },
    ]);
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    const result = await runCommand(domainListCommand, ["my-site"]);

    expect(result.error).toBeUndefined();
    expect(JSON.parse(stdout.output)).toEqual([
      {
        domain: "www.example.com",
        status: "active",
        trafficCnameTarget: "traffic.example.net",
        certificateCnameTarget: "cert.example.net",
      },
    ]);
  });

  test("emits an empty array in JSON mode when no custom domains exist", async () => {
    mockCustomDomains([]);
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    const result = await runCommand(domainListCommand, ["my-site"]);

    expect(result.error).toBeUndefined();
    expect(stdout.output).not.toBe("");
    expect(JSON.parse(stdout.output)).toEqual([]);
  });

  test("prints no stdout output when empty outside JSON mode", async () => {
    mockCustomDomains([]);
    using stdout = captureStdout();
    using _stderr = captureStderr();

    const result = await runCommand(domainListCommand, ["my-site"]);

    expect(result.error).toBeUndefined();
    expect(stdout.output).toBe("");
  });
});
