import { createType, timestampFields } from "@tailor-platform/sdk";
import { organization } from "./organization";

export const subscription = createType(
  "Subscription",
  {
    organizationId: {
      kind: "uuid",
      relation: { type: "n-1", toward: { type: organization } },
    },
    plan: { kind: "enum", values: ["FREE", "STARTER", "BUSINESS", "ENTERPRISE"] },
    status: { kind: "enum", values: ["TRIAL", "ACTIVE", "PAUSED", "CANCELLED"] },
    startDate: { kind: "date" },
    endDate: { kind: "date", optional: true },
    monthlyRate: {
      kind: "float",
      validate: [({ value }) => value >= 0, "monthlyRate must be non-negative"],
    },
    autoRenew: { kind: "bool" },
    ...timestampFields(),
  },
  {
    indexes: [{ fields: ["organizationId", "status"] }],
    features: { aggregation: true },
  },
);
export type subscription = typeof subscription;
