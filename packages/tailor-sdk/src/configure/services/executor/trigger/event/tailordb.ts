import { type TailorDBType } from "@/configure/services/tailordb/schema";
import { type output } from "@/configure/types/helpers";
import { type ConditionArgs, type RecordTriggerCondition } from "./types";
import type { EventTrigger, WithArgs } from "../../types";

interface withNewRecord<T extends TailorDBType> {
  newRecord: output<T>;
}
interface withOldRecord<T extends TailorDBType> {
  oldRecord: output<T>;
}
interface RecordTriggerConditionArgs extends ConditionArgs {
  typeName: string;
}

export function recordCreatedTrigger<T extends TailorDBType>(
  type: T,
  condition?: RecordTriggerCondition<
    RecordTriggerConditionArgs & withNewRecord<T>
  >,
): EventTrigger & WithArgs<RecordTriggerConditionArgs & withNewRecord<T>> {
  const argsMap = /* js */ `{ ...args, appNamespace: args.namespaceName }`;
  return {
    Kind: "Event",
    EventType: {
      kind: "tailordb.type_record.created",
      typeName: type.name,
    },
    Condition: [
      /* js */ `args.typeName === "${type.name}"`,
      ...(condition ? [/* js */ `(${condition.toString()})(${argsMap})`] : []),
    ].join(" && "),
    _args: {} as RecordTriggerConditionArgs & withNewRecord<T>,
  };
}

export function recordUpdatedTrigger<T extends TailorDBType>(
  type: T,
  condition: RecordTriggerCondition<
    RecordTriggerConditionArgs & withNewRecord<T> & withOldRecord<T>
  > = () => true,
): EventTrigger &
  WithArgs<RecordTriggerConditionArgs & withNewRecord<T> & withOldRecord<T>> {
  const argsMap = /* js */ `{ ...args, appNamespace: args.namespaceName }`;
  return {
    Kind: "Event",
    EventType: {
      kind: "tailordb.type_record.updated",
      typeName: type.name,
    },
    Condition: [
      /* js */ `args.typeName === "${type.name}"`,
      /* js */ `(${condition.toString()})(${argsMap})`,
    ].join(" && "),
    _args: {} as RecordTriggerConditionArgs &
      withNewRecord<T> &
      withOldRecord<T>,
  };
}

export function recordDeletedTrigger<T extends TailorDBType>(
  type: T,
  condition: RecordTriggerCondition<
    RecordTriggerConditionArgs & withOldRecord<T>
  > = () => true,
): EventTrigger & WithArgs<RecordTriggerConditionArgs & withOldRecord<T>> {
  const argsMap = /* js */ `{ ...args, appNamespace: args.namespaceName }`;
  return {
    Kind: "Event",
    EventType: {
      kind: "tailordb.type_record.deleted",
      typeName: type.name,
    },
    Condition: [
      /* js */ `args.typeName === "${type.name}"`,
      /* js */ `(${condition.toString()})(${argsMap})`,
    ].join(" && "),
    _args: {} as RecordTriggerConditionArgs & withOldRecord<T>,
  };
}
