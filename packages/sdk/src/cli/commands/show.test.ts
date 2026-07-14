import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { show } from "./show";

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("#/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

describe("show", () => {
  let getWorkspaceMock: ReturnType<typeof vi.fn>;
  let getApplicationMock: ReturnType<typeof vi.fn>;
  let getAIGatewayMock: ReturnType<typeof vi.fn>;

  const application = {
    name: "my-app",
    domain: "my-app.example.com",
    url: "https://my-app.example.com",
    authNamespace: "my-auth",
    cors: [],
    allowedIpAddresses: [],
    disableIntrospection: false,
    createTime: timestampFromDate(new Date("2026-01-01T00:00:00Z")),
    updateTime: timestampFromDate(new Date("2026-02-01T00:00:00Z")),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");
    vi.mocked(loadConfig).mockResolvedValue({
      config: {
        name: "my-app",
        aiGateways: [{ name: "gateway-a" }, { name: "gateway-b" }],
      },
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);

    getWorkspaceMock = vi.fn().mockResolvedValue({
      workspace: { name: "my-workspace", region: "us" },
    });
    getApplicationMock = vi.fn().mockResolvedValue({ application });
    getAIGatewayMock = vi.fn();
    vi.mocked(initOperatorClient).mockResolvedValue({
      getWorkspace: getWorkspaceMock,
      getApplication: getApplicationMock,
      getAIGateway: getAIGatewayMock,
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
  });

  test("includes the URL of every configured AI Gateway", async () => {
    getAIGatewayMock.mockImplementation(({ aigatewayName }: { aigatewayName: string }) =>
      Promise.resolve({
        aigateway: { name: aigatewayName, url: `https://${aigatewayName}.example.com` },
      }),
    );

    const info = await show();

    expect(info.aiGateways).toEqual([
      { name: "gateway-a", url: "https://gateway-a.example.com" },
      { name: "gateway-b", url: "https://gateway-b.example.com" },
    ]);
    expect(getAIGatewayMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      aigatewayName: "gateway-a",
    });
    expect(getAIGatewayMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      aigatewayName: "gateway-b",
    });
  });

  test("omits AI Gateways that have not been deployed yet", async () => {
    getAIGatewayMock.mockImplementation(({ aigatewayName }: { aigatewayName: string }) => {
      if (aigatewayName === "gateway-a") {
        return Promise.resolve({
          aigateway: { name: "gateway-a", url: "https://gateway-a.example.com" },
        });
      }
      return Promise.reject(new ConnectError("not found", Code.NotFound));
    });

    const info = await show();

    expect(info.aiGateways).toEqual([{ name: "gateway-a", url: "https://gateway-a.example.com" }]);
  });

  test("returns an empty array when no AI Gateway is configured", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      config: { name: "my-app" },
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);

    const info = await show();

    expect(info.aiGateways).toEqual([]);
    expect(getAIGatewayMock).not.toHaveBeenCalled();
  });
});
