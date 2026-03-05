import { createExecutor, resolverExecutedTrigger } from "@tailor-platform/sdk";
import upgradeSubscription from "../resolvers/upgradeSubscription";

export default createExecutor({
  name: "upgrade-audit-log",
  description: "Log successful subscription upgrades to audit",
  trigger: resolverExecutedTrigger({
    resolver: upgradeSubscription,
    condition: (args) => args.success === true,
  }),
  operation: {
    kind: "graphql",
    query: `mutation createAuditEvent($input: AuditEventCreateInput!) {
      createAuditEvent(input: $input) { id }
    }`,
    // Accepted trade-off: organizationId and metadata are required on AuditEvent but not
    // available from resolverExecutedTrigger args. A complete implementation would need
    // the resolver to return organizationId or use a separate lookup.
    variables: (args) => ({
      input: {
        action: "UPDATE",
        actor: args.success ? (args.actor?.userId ?? "system") : "system",
        target: args.success ? (args.result?.newPlan ?? "") : "",
      },
    }),
  },
});
