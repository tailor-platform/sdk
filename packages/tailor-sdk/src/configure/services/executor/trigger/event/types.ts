export type RecordTriggerCondition<A> = (args: A) => boolean;
export type ConditionArgs = {
  workspaceId: string;
  appNamespace: string;
};
