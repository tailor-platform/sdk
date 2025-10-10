import { type EventTrigger, type ManifestAndContext } from "../../types";
import { type Script } from "@/configure/types/types";

export type RecordTriggerCondition<A> = (args: A) => boolean;
export type ConditionArgs = {
  workspaceId: string;
  appNamespace: string;
};

type EventTriggerContext<T> = {
  args: T;
  type?: string;
  variables: Script;
};

export type EventTriggerWithManifestAndContext<T> = ManifestAndContext<
  EventTrigger,
  EventTriggerContext<T>
>;
