export * from "./event";
export * from "./schedule";
export * from "./webhook";

import type {
  RecordTrigger,
  ResolverExecutedTrigger,
  IdpUserTrigger,
  AuthAccessTokenTrigger,
  MultiRecordTrigger,
  MultiIdpUserTrigger,
  MultiAuthAccessTokenTrigger,
} from "./event";
import type { ScheduleTrigger } from "./schedule";
import type { IncomingWebhookTrigger } from "./webhook";

export type Trigger<Args> =
  | RecordTrigger<Args>
  | ResolverExecutedTrigger<Args>
  | ScheduleTrigger<Args>
  | IncomingWebhookTrigger<Args>
  | IdpUserTrigger<Args>
  | AuthAccessTokenTrigger<Args>
  | MultiRecordTrigger<Args>
  | MultiIdpUserTrigger<Args>
  | MultiAuthAccessTokenTrigger<Args>;
