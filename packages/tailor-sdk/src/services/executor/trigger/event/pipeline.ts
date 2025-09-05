import { type Resolver } from "@/services/pipeline/resolver";
import {
  type ConditionArgs,
  type EventTriggerWithManifestAndContext,
  type RecordTriggerCondition,
} from "./types";
import { type output } from "@/types/helpers";

type ResolverTriggerConditionArgs<R extends Resolver> = ConditionArgs & {
  resolverName: R["name"];
} & (
    | {
        result: output<R["output"]>;
        error: undefined;
      }
    | {
        result: undefined;
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
      variables: { expr: `(${argsMap})` },
    },
  } satisfies EventTriggerWithManifestAndContext<
    ResolverTriggerConditionArgs<R>
  >;
}
