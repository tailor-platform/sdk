import { createType, timestampFields } from "@tailor-platform/sdk";

export const organization = createType(
  "Organization",
  {
    name: { kind: "string" },
    domain: { kind: "string", unique: true },
    plan: { kind: "enum", values: ["FREE", "STARTER", "BUSINESS", "ENTERPRISE"] },
    billingAddress: {
      kind: "object",
      fields: {
        street: { kind: "string" },
        city: { kind: "string" },
        state: { kind: "string" },
        postalCode: { kind: "string" },
        country: { kind: "string" },
      },
    },
    orgCode: { kind: "string", serial: { start: 1, format: "ORG-%04d" } },
    contactEmail: {
      kind: "string",
      unique: true,
      hooks: { create: ({ value }) => (value ? value.toLowerCase() : "") },
    },
    maxSeats: {
      kind: "int",
      hooks: { create: ({ value }) => value ?? 5 },
    },
    active: { kind: "bool" },
    tags: { kind: "string", array: true, optional: true },
    ...timestampFields(),
  },
  {
    description: "Organizations on the SaaS platform",
    permission: {
      create: [[{ user: "_loggedIn" }, "=", true]],
      read: [[{ user: "_loggedIn" }, "=", true]],
      update: [[{ user: "plan" }, "=", "ENTERPRISE"]],
      delete: [[{ user: "plan" }, "=", "ENTERPRISE"]],
    },
    gqlPermission: [
      { conditions: [[{ user: "plan" }, "=", "ENTERPRISE"]], actions: "all", permit: true },
      {
        conditions: [[{ user: "_loggedIn" }, "=", true]],
        actions: ["read", "create"],
        permit: true,
      },
    ],
  },
);
export type organization = typeof organization;
