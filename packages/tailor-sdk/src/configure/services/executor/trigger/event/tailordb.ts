import { type TailorDBType } from "@/configure/services/tailordb/schema";
import { type output } from "@/configure/types/helpers";
import {
  type ConditionArgs,
  type EventTriggerWithManifestAndContext,
  type RecordTriggerCondition,
} from "./types";

interface withNewRecord<T extends TailorDBType> {
  newRecord: output<T>;
}
interface withOldRecord<T extends TailorDBType> {
  oldRecord: output<T>;
}
interface RecordTriggerConditionArgs<T extends TailorDBType>
  extends ConditionArgs {
  typeName: T["name"];
}

export function recordCreatedTrigger<T extends TailorDBType>(
  type: T,
  condition?: RecordTriggerCondition<
    RecordTriggerConditionArgs<T> & withNewRecord<T>
  >,
) {
  const argsMap = /* js */ `{ ...args, appNamespace: args.namespaceName }`;
  return {
    manifest: {
      Kind: "Event",
      EventType: "tailordb.type_record.created",
      Condition: {
        Expr: [
          /* js */ `args.typeName === "${type.name}"`,
          ...(condition
            ? [/* js */ `(${condition.toString()})(${argsMap})`]
            : []),
        ].join(" && "),
      },
    },
    context: {
      args: {} as RecordTriggerConditionArgs<T> & withNewRecord<T>,
      type: type.name,
      variables: {
        expr: `(${argsMap})`,
      },
    },
  } satisfies EventTriggerWithManifestAndContext<
    RecordTriggerConditionArgs<T> & withNewRecord<T>
  >;
}

export function recordUpdatedTrigger<T extends TailorDBType>(
  type: T,
  condition: RecordTriggerCondition<
    RecordTriggerConditionArgs<T> & withNewRecord<T> & withOldRecord<T>
  > = () => true,
) {
  const argsMap = /* js */ `{ ...args, appNamespace: args.namespaceName }`;
  return {
    manifest: {
      Kind: "Event",
      EventType: "tailordb.type_record.updated",
      Condition: {
        Expr: [
          /* js */ `args.typeName === "${type.name}"`,
          /* js */ `(${condition.toString()})(${argsMap})`,
        ].join(" && "),
      },
    },
    context: {
      args: {} as RecordTriggerConditionArgs<T> &
        withNewRecord<T> &
        withOldRecord<T>,
      type: type.name,
      variables: {
        expr: `(${argsMap})`,
      },
    },
  } satisfies EventTriggerWithManifestAndContext<
    RecordTriggerConditionArgs<T> & withNewRecord<T> & withOldRecord<T>
  >;
}

export function recordDeletedTrigger<T extends TailorDBType>(
  type: T,
  condition: RecordTriggerCondition<
    RecordTriggerConditionArgs<T> & withOldRecord<T>
  > = () => true,
) {
  const argsMap = /* js */ `{ ...args, appNamespace: args.namespaceName }`;
  return {
    manifest: {
      Kind: "Event",
      EventType: "tailordb.type_record.deleted",
      Condition: {
        Expr: [
          /* js */ `args.typeName === "${type.name}"`,
          /* js */ `(${condition.toString()})(${argsMap})`,
        ].join(" && "),
      },
    },
    context: {
      args: {} as RecordTriggerConditionArgs<T> & withOldRecord<T>,
      type: type.name,
      variables: {
        expr: `(${argsMap})`,
      },
    },
  } satisfies EventTriggerWithManifestAndContext<
    RecordTriggerConditionArgs<T> & withOldRecord<T>
  >;
}
