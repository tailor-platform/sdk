import { TailorDBType } from "@/services/tailordb/schema";
import { output } from "@/types/helpers";
import {
  ConditionArgs,
  EventTriggerWithManifestAndContext,
  RecordTriggerCondition,
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
  condition: RecordTriggerCondition<
    RecordTriggerConditionArgs<T> & withNewRecord<T>
  > = () => true,
) {
  const argsMap = /* js */ `{ ...args, appNamespace: args.namespaceName }`;
  return {
    manifest: {
      Kind: "Event",
      EventType: "tailordb.type_record.created",
      Condition: {
        Expr: [
          /* js */ `args.typeName === "${type.name}"`,
          /* js */ `(${condition.toString()})(${argsMap})`,
        ].join(" && "),
      },
    },
    context: {
      args: {} as RecordTriggerConditionArgs<T> & withNewRecord<T>,
      type: type.name,
      variables: {
        Expr: `(${argsMap})`,
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
        Expr: `(${argsMap})`,
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
        Expr: `(${argsMap})`,
      },
    },
  } satisfies EventTriggerWithManifestAndContext<
    RecordTriggerConditionArgs<T> & withOldRecord<T>
  >;
}
