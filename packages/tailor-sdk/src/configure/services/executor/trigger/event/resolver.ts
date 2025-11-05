import { type output } from "@/configure/types/helpers";
import { type ConditionArgs, type RecordTriggerCondition } from "./types";
import type { EventTrigger, WithArgs } from "../../types";
import type { ResolverConfig } from "@/configure/services/resolver/resolver";

type ResolverTriggerConditionArgs<R extends ResolverConfig> = ConditionArgs & {
  resolverName: string;
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

export function resolverExecutedTrigger<R extends ResolverConfig>(
  resolver: R,
  condition: RecordTriggerCondition<ResolverTriggerConditionArgs<R>> = () =>
    true,
): EventTrigger & WithArgs<ResolverTriggerConditionArgs<R>> {
  const argsMap = /* js */ `{ ...args, appNamespace: args.namespaceName, result: args.succeeded?.result, error: args.failed?.error }`;
  return {
    Kind: "Event",
    EventType: {
      kind: "pipeline.resolver.executed",
      resolverName: resolver.name,
    },
    Condition: [
      /* js */ `args.resolverName === "${resolver.name}"`,
      /* js */ `(${condition.toString()})(${argsMap})`,
    ].join(" && "),
    _args: {} as ResolverTriggerConditionArgs<R>,
  };
}
