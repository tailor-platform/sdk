import { IncomingWebhookTrigger, ManifestAndContext } from "../types";

export type IncomingWebhookTriggerContext<T> = {
  args: T;
};

export type IncomingWebhookTriggerWithManifestAndContext<T> =
  ManifestAndContext<IncomingWebhookTrigger, IncomingWebhookTriggerContext<T>>;

export function incomingWebhookTrigger<
  T,
>(): IncomingWebhookTriggerWithManifestAndContext<T> {
  return {
    manifest: {
      Kind: "IncomingWebhook",
    },
    context: {
      args: {} as T,
    },
  };
}
