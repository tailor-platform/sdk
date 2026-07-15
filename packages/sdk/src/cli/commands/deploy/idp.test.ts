import { Code, ConnectError } from "@connectrpc/connect";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { applyIdP, type planIdP } from "./idp";
import type { OperatorClient } from "#/cli/shared/client";

describe("applyIdP phase separation", () => {
  function createMockClientWithSpies() {
    return {
      deleteIdPClient: vi.fn().mockResolvedValue({}),
      deleteIdPService: vi.fn().mockResolvedValue({}),
      deleteSecretManagerVault: vi.fn().mockResolvedValue({}),
      createIdPService: vi.fn().mockResolvedValue({}),
      createIdPClient: vi.fn().mockResolvedValue({}),
      updateIdPClient: vi.fn().mockResolvedValue({}),
      createSecretManagerVault: vi.fn().mockResolvedValue({}),
      createSecretManagerSecret: vi.fn().mockResolvedValue({}),
      setMetadata: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;
  }

  function createMockPlanResult() {
    return {
      changeSet: {
        service: {
          creates: [],
          updates: [],
          deletes: [
            {
              name: "test-idp",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-idp",
              },
            },
          ],
          title: "IdP Services",
          isEmpty: () => false,
          lines: () => [],
        },
        client: {
          creates: [],
          updates: [],
          deletes: [
            {
              name: "test-client",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-idp",
                name: "test-client",
              },
            },
          ],
          title: "IdP Clients",
          isEmpty: () => false,
          lines: () => [],
        },
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
    } as unknown as Awaited<ReturnType<typeof planIdP>>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test.each([
    [
      "delete-resources phase deletes clients and vaults, but NOT services",
      "delete-resources",
      1,
      1,
      0,
    ],
    ["delete-services phase deletes ONLY services", "delete-services", 0, 0, 1],
    ["create-update phase does not delete anything", "create-update", 0, 0, 0],
  ] as const)("%s", async (_, phase, clientCalls, vaultCalls, serviceCalls) => {
    const client = createMockClientWithSpies();
    const planResult = createMockPlanResult();

    await applyIdP(client, planResult, phase);

    expect(client.deleteIdPClient).toHaveBeenCalledTimes(clientCalls);
    expect(client.deleteSecretManagerVault).toHaveBeenCalledTimes(vaultCalls);
    expect(client.deleteIdPService).toHaveBeenCalledTimes(serviceCalls);
  });
});

describe("applyIdP allowedReturnOrigins placeholder resolution", () => {
  function createPlanResult(opts: {
    op: "create" | "update";
    origins: string[];
  }): Awaited<ReturnType<typeof planIdP>> {
    const entry = {
      name: "test-idp",
      request: {
        workspaceId: "test-workspace",
        namespaceName: "test-idp",
        userAuthPolicy: {
          enableMfa: true,
          allowedReturnOrigins: [...opts.origins],
        },
      },
      metaRequest: { trn: "", labels: {} },
    };
    return {
      changeSet: {
        service: {
          creates: opts.op === "create" ? [entry] : [],
          updates: opts.op === "update" ? [entry] : [],
          deletes: [],
          title: "IdP Services",
          isEmpty: () => false,
          print: () => {},
        },
        client: {
          creates: [],
          updates: [],
          deletes: [],
          title: "IdP Clients",
          isEmpty: () => true,
          print: () => {},
        },
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
    } as unknown as Awaited<ReturnType<typeof planIdP>>;
  }

  const defaultGetStaticWebsite = () =>
    vi.fn().mockResolvedValue({ staticwebsite: { url: "https://my-site.example.com" } });

  function createClient(getStaticWebsite = defaultGetStaticWebsite()) {
    return {
      createIdPService: vi.fn().mockResolvedValue({}),
      updateIdPService: vi.fn().mockResolvedValue({}),
      setMetadata: vi.fn().mockResolvedValue({}),
      getStaticWebsite,
    } as unknown as OperatorClient;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("resolves :url placeholder before createIdPService", async () => {
    const client = createClient();
    await applyIdP(
      client,
      createPlanResult({ op: "create", origins: ["my-site:url", "https://other.example.com"] }),
      "create-update",
    );

    expect(client.getStaticWebsite).toHaveBeenCalledWith({
      workspaceId: "test-workspace",
      name: "my-site",
    });
    expect(client.createIdPService).toHaveBeenCalledTimes(1);
    const req = (client.createIdPService as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      userAuthPolicy: { allowedReturnOrigins: string[] };
    };
    expect(req.userAuthPolicy.allowedReturnOrigins).toEqual([
      "https://my-site.example.com",
      "https://other.example.com",
    ]);
  });

  test("resolves :url placeholder before updateIdPService", async () => {
    const client = createClient();
    await applyIdP(
      client,
      createPlanResult({ op: "update", origins: ["my-site:url"] }),
      "create-update",
    );

    expect(client.updateIdPService).toHaveBeenCalledTimes(1);
    const req = (client.updateIdPService as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      userAuthPolicy: { allowedReturnOrigins: string[] };
    };
    expect(req.userAuthPolicy.allowedReturnOrigins).toEqual(["https://my-site.example.com"]);
  });

  test("skips static-website lookup when allowedReturnOrigins has no placeholder", async () => {
    const client = createClient();
    await applyIdP(
      client,
      createPlanResult({ op: "create", origins: ["https://app.example.com"] }),
      "create-update",
    );

    expect(client.getStaticWebsite).not.toHaveBeenCalled();
    const req = (client.createIdPService as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      userAuthPolicy: { allowedReturnOrigins: string[] };
    };
    expect(req.userAuthPolicy.allowedReturnOrigins).toEqual(["https://app.example.com"]);
  });

  test("fails fast when a placeholder cannot be resolved (NotFound)", async () => {
    const client = createClient(
      vi.fn().mockRejectedValue(new ConnectError("not found", Code.NotFound)),
    );

    await expect(
      applyIdP(
        client,
        createPlanResult({ op: "create", origins: ["missing-site:url"] }),
        "create-update",
      ),
    ).rejects.toThrow(/1 of 1 entries could not be resolved/);
    expect(client.createIdPService).not.toHaveBeenCalled();
  });

  test("fails fast when a placeholder resolves to a website without URL", async () => {
    const client = createClient(vi.fn().mockResolvedValue({ staticwebsite: { url: "" } }));

    await expect(
      applyIdP(
        client,
        createPlanResult({
          op: "update",
          origins: ["unassigned-site:url", "https://other.example.com"],
        }),
        "create-update",
      ),
    ).rejects.toThrow(/1 of 2 entries could not be resolved/);
    expect(client.updateIdPService).not.toHaveBeenCalled();
  });
});
