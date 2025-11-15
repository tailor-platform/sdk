export * from "./event";
export * from "./schedule";
export * from "./webhook";

import type { RecordTrigger, ResolverExecutedTrigger } from "./event";
import type { ScheduleTrigger } from "./schedule";
import type { IncomingWebhookTrigger } from "./webhook";

export type Trigger<Args> =
  | RecordTrigger<Args>
  | ResolverExecutedTrigger<Args>
  | ScheduleTrigger<Args>
  | IncomingWebhookTrigger<Args>;
