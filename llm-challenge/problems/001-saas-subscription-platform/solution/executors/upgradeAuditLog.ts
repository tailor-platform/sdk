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
    variables: (args) => ({
      input: {
        action: "UPDATE",
        actor: args.actor?.userId ?? "system",
        target: args.result?.newPlan ?? "",
      },
    }),
  },
});
