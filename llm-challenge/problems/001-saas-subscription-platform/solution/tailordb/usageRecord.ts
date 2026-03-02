import { createType, timestampFields } from "@tailor-platform/sdk";
import { subscription } from "./subscription";

export const usageRecord = createType("UsageRecord", {
  subscriptionId: {
    kind: "uuid",
    relation: { type: "n-1", toward: { type: subscription } },
  },
  metric: { kind: "string" },
  quantity: {
    kind: "float",
    validate: [({ value }) => value > 0, "quantity must be positive"],
  },
  recordedAt: { kind: "datetime", hooks: { create: () => new Date() } },
  description: { kind: "string", optional: true },
  ...timestampFields(),
});
export type usageRecord = typeof usageRecord;
