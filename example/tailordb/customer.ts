import { db } from "@tailor-platform/sdk";
import { defaultGqlPermission, defaultPermission } from "./permissions";

export const customer = db
  .type("Customer", "Customer information", {
    name: db.string(),
    email: db.string(),
    phone: db.string({ optional: true }),
    country: db.string(),
    postalCode: db.string(),
    address: db.string({ optional: true }),
    city: db.string({ optional: true }),
    fullAddress: db.string(),
    state: db.string(),
    ...db.fields.timestamps(),
  })
  .hooks({
    create: ({ data }) => ({
      fullAddress: `${data.postalCode} ${data.address ?? ""} ${data.city ?? ""}`,
      createdAt: new Date(),
    }),
    update: ({ data }) => ({
      fullAddress: `${data.postalCode} ${data.address ?? ""} ${data.city ?? ""}`,
      updatedAt: new Date(),
    }),
  })
  .validate([
    [({ data }) => data.name.length > 5, "Name must be longer than 5 characters"],
    ({ data }) => (data.city ? data.city.length > 1 && data.city.length < 100 : true),
  ])
  .permission(defaultPermission)
  .gqlPermission(defaultGqlPermission);
