import { bench } from "@ark/attest";
import type * as sdk from "../../../src/configure";

declare const db: typeof sdk.db;
declare const t: typeof sdk.t;
declare const createResolver: typeof sdk.createResolver;
declare const createExecutor: typeof sdk.createExecutor;
declare const incomingWebhookTrigger: typeof sdk.incomingWebhookTrigger;

bench("tailordb-baseline", () => db.table("Baseline", { name: db.string() })).types([
  947,
  "instantiations",
]);

bench("resolver-baseline", () =>
  createResolver({
    name: "baseline",
    operation: "query",
    input: { id: t.string() },
    body: async (context) => ({ id: context.input.id }),
    output: t.object({ id: t.string() }),
  })).types([4641, "instantiations"]);

bench("executor-baseline", () =>
  createExecutor({
    name: "baseline",
    description: "Baseline executor",
    trigger: incomingWebhookTrigger(),
    operation: {
      kind: "function",
      body: async () => {
        console.log("Baseline executed");
      },
    },
  })).types([848, "instantiations"]);
