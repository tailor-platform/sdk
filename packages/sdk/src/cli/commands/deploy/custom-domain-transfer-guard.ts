import { CLIError } from "#/cli/shared/errors";
import type { PlannedDeployment } from "./apply-phases";

/**
 * Reject plans whose custom domain transfers cannot be applied safely.
 *
 * Runs across every deployment in the run, after cross-deployment deletes have
 * been dropped, because both conditions below span deployments and depend on
 * which deletes survived.
 * @param deployments - Planned deployments to check
 */
export function assertNoSingleRunTransferHandoff(
  deployments: ReadonlyArray<PlannedDeployment>,
): void {
  const requested = new Map<string, string>();
  const created = new Set<string>();

  for (const deployment of deployments) {
    const { staticWebsite } = deployment;

    // A domain removed from config while it is still offered: removing it would
    // tear down the edge configuration the pending transfer depends on.
    for (const del of staticWebsite.customDomainChangeSet.deletes) {
      const offer = staticWebsite.customDomainLiveOffers.get(del.name);
      if (offer) {
        throw CLIError({
          code: "CUSTOM_DOMAIN_TRANSFER_IN_FLIGHT",
          message: `Custom domain "${del.name}" is offered to workspace ${offer.targetWorkspaceId} and is no longer declared on a static website.`,
          suggestion:
            "Change the entry back to a plain string to cancel the transfer, deploy, then remove it.",
          details:
            "Removing the domain now would tear down its edge configuration while the transfer is still pending, and the target could no longer accept it.",
          context: {
            resourceType: "staticwebsite.custom_domain_transfer",
            domain: del.name,
            targetWorkspaceId: offer.targetWorkspaceId,
          },
        });
      }
    }

    for (const request of staticWebsite.customDomainTransferChangeSet.creates) {
      requested.set(request.name, request.staticWebsiteName);
    }
    for (const add of staticWebsite.customDomainChangeSet.creates) {
      created.add(add.name);
    }
  }

  // Deployments apply in array order, and a deployment finishes its transfer
  // requests only after its domain adds. Completing a transfer in the same run
  // that opens it would therefore succeed or fail on config order alone.
  for (const [domain, staticWebsiteName] of requested) {
    if (created.has(domain)) {
      throw CLIError({
        code: "CUSTOM_DOMAIN_TRANSFER_SAME_RUN",
        message: `Custom domain "${domain}" is both offered for transfer and added to a static website in this deploy.`,
        suggestion:
          "Deploy the offer first, then add the domain to the receiving site in a second deploy.",
        details:
          "The receiving side completes the transfer by adding the domain, which the platform refuses until the offer exists.",
        context: {
          resourceType: "staticwebsite.custom_domain_transfer",
          domain,
          staticWebsiteName,
        },
      });
    }
  }
}
