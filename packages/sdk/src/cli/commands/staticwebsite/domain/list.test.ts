import { CustomDomainStatus } from "@tailor-platform/tailor-proto/staticwebsite_resource_pb";
import { runCommand } from "politty";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { logger } from "#/cli/shared/logger";
import { domainListCommand } from "./list";

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
  loadWorkspaceId: vi.fn().mockResolvedValue("mock-workspace-id"),
}));

vi.mock("#/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/logger", () => ({
  logger: {
    info: vi.fn(),
    out: vi.fn(),
    jsonMode: false,
  },
}));

function mockCustomDomains(customDomains: unknown[]) {
  vi.mocked(initOperatorClient).mockResolvedValue({
    listCustomDomains: vi.fn().mockResolvedValue({ customDomains }),
  } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
}

describe("staticwebsite domain list", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    logger.jsonMode = false;
    await runTest();
  });

  test("prints formatted domains", async () => {
    mockCustomDomains([
      {
        domain: "www.example.com",
        status: CustomDomainStatus.ACTIVE,
        trafficCnameTarget: "traffic.example.net",
        certificateCnameTarget: "cert.example.net",
      },
    ]);

    const result = await runCommand(domainListCommand, ["my-site"]);

    expect(result.error).toBeUndefined();
    expect(logger.out).toHaveBeenCalledWith([
      {
        domain: "www.example.com",
        status: "active",
        trafficCnameTarget: "traffic.example.net",
        certificateCnameTarget: "cert.example.net",
      },
    ]);
  });

  test("emits an empty array in JSON mode when no custom domains exist", async () => {
    logger.jsonMode = true;
    mockCustomDomains([]);

    const result = await runCommand(domainListCommand, ["my-site"]);

    expect(result.error).toBeUndefined();
    expect(logger.out).toHaveBeenCalledWith([]);
  });

  test("prints an informational message without stdout output when empty outside JSON mode", async () => {
    mockCustomDomains([]);

    const result = await runCommand(domainListCommand, ["my-site"]);

    expect(result.error).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith("No custom domains found.");
    expect(logger.out).not.toHaveBeenCalled();
  });
});
