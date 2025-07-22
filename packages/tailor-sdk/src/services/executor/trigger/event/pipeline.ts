import { Resolver } from "@/services/pipeline/resolver";
import {
  ConditionArgs,
  EventTriggerWithManifestAndContext,
  RecordTriggerCondition,
} from "./types";

type ResolverTriggerConditionArgs<R extends Resolver> = ConditionArgs & {
  resolverName: R["name"];
} & (
    | {
        result: R["output"];
      }
    | {
        error: string;
      }
  );

export function resolverExecutedTrigger<R extends Resolver>(
  resolver: R,
  condition: RecordTriggerCondition<ResolverTriggerConditionArgs<R>> = () =>
    true,
) {
  const argsMap = /* js */ `{ ...args, appNamespace: args.namespaceName, result: args.succeeded?.result, error: args.failed?.error }`;
  return {
    manifest: {
      Kind: "Event",
      EventType: "pipeline.resolver.executed",
      Condition: {
        Expr: [
          /* js */ `args.resolverName === "${resolver.name}"`,
          /* js */ `(${condition.toString()})(${argsMap})`,
        ].join(" && "),
      },
    },
    context: {
      args: {} as ResolverTriggerConditionArgs<R>,
      variables: { Expr: `(${argsMap})` },
    },
  } satisfies EventTriggerWithManifestAndContext<
    ResolverTriggerConditionArgs<R>
  >;
}
