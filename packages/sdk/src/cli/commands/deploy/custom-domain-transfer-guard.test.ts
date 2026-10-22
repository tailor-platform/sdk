import { describe, expect, test } from "vitest";
import { createChangeSet } from "./change-set";
import { assertNoSingleRunTransferHandoff } from "./custom-domain-transfer-guard";
import type { PlannedDeployment } from "./apply-phases";
import type { CustomDomainTransfer } from "@tailor-platform/tailor-proto/staticwebsite_resource_pb";

type TransferEntry = {
  name: string;
  staticWebsiteName: string;
  request: { workspaceId: string; domain: string; targetWorkspaceId?: string };
};

type DeploymentSpec = {
  adds?: string[];
  removes?: string[];
  requests?: Array<{ domain: string; target: string }>;
  liveOffers?: Array<{ domain: string; target: string }>;
};

function deployment(spec: DeploymentSpec): PlannedDeployment {
  const customDomainChangeSet = createChangeSet("CustomDomains");
  const customDomainTransferChangeSet = createChangeSet<TransferEntry, never, TransferEntry>(
    "CustomDomainTransfers",
  );

  for (const domain of spec.adds ?? []) {
    customDomainChangeSet.creates.push({ name: domain });
  }
  for (const domain of spec.removes ?? []) {
    customDomainChangeSet.deletes.push({ name: domain });
  }
  for (const { domain, target } of spec.requests ?? []) {
    customDomainTransferChangeSet.creates.push({
      name: domain,
      staticWebsiteName: "site-a",
      request: { workspaceId: "ws", domain, targetWorkspaceId: target },
    });
  }
  const customDomainLiveOffers = new Map(
    (spec.liveOffers ?? []).map(({ domain, target }) => [
      domain,
      { domain, targetWorkspaceId: target } as CustomDomainTransfer,
    ]),
  );

  return {
    staticWebsite: {
      customDomainChangeSet,
      customDomainTransferChangeSet,
      customDomainLiveOffers,
    },
  } as unknown as PlannedDeployment;
}

describe("assertNoSingleRunTransferHandoff", () => {
  test("allows a plan that only opens offers", () => {
    expect(() =>
      assertNoSingleRunTransferHandoff([
        deployment({ requests: [{ domain: "example.com", target: "ws-b" }] }),
      ]),
    ).not.toThrow();
  });

  test("allows an add for a domain no offer in this run names", () => {
    expect(() =>
      assertNoSingleRunTransferHandoff([
        deployment({ requests: [{ domain: "a.example.com", target: "ws-b" }] }),
        deployment({ adds: ["b.example.com"] }),
      ]),
    ).not.toThrow();
  });

  test("rejects removing a domain that is still offered", () => {
    expect(() =>
      assertNoSingleRunTransferHandoff([
        deployment({
          removes: ["example.com"],
          liveOffers: [{ domain: "example.com", target: "ws-b" }],
        }),
      ]),
    ).toThrow(expect.objectContaining({ code: "CUSTOM_DOMAIN_TRANSFER_IN_FLIGHT" }));
  });

  test("allows removing a domain with no live offer", () => {
    expect(() =>
      assertNoSingleRunTransferHandoff([deployment({ removes: ["example.com"] })]),
    ).not.toThrow();
  });

  test("rejects offering and adding the same domain in one run", () => {
    expect(() =>
      assertNoSingleRunTransferHandoff([
        deployment({ requests: [{ domain: "example.com", target: "ws-b" }] }),
        deployment({ adds: ["example.com"] }),
      ]),
    ).toThrow(expect.objectContaining({ code: "CUSTOM_DOMAIN_TRANSFER_SAME_RUN" }));
  });

  test("rejects it regardless of which deployment comes first", () => {
    expect(() =>
      assertNoSingleRunTransferHandoff([
        deployment({ adds: ["example.com"] }),
        deployment({ requests: [{ domain: "example.com", target: "ws-b" }] }),
      ]),
    ).toThrow(expect.objectContaining({ code: "CUSTOM_DOMAIN_TRANSFER_SAME_RUN" }));
  });

  test("rejects a same-workspace handoff expressed in one config", () => {
    expect(() =>
      assertNoSingleRunTransferHandoff([
        deployment({
          requests: [{ domain: "example.com", target: "ws" }],
          adds: ["example.com"],
        }),
      ]),
    ).toThrow(expect.objectContaining({ code: "CUSTOM_DOMAIN_TRANSFER_SAME_RUN" }));
  });
});
