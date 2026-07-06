import { db } from "@tailor-platform/sdk";
import { defaultGqlPermission, defaultPermission } from "./permissions";

export const customer = db
  .type("Customer", "Customer information", {
    name: db
      .string()
      .validate(({ value }) =>
        value.length <= 5 ? "Name must be longer than 5 characters" : undefined,
      ),
    email: db.string(),
    phone: db.string({ optional: true }),
    country: db.string(),
    postalCode: db.string(),
    address: db.string({ optional: true }),
    city: db.string({ optional: true }).validate(
      ({ value }) =>
        value && value.length <= 1 ? "City must be longer than 1 character" : undefined,
      ({ value }) =>
        value && value.length >= 100 ? "City must be shorter than 100 characters" : undefined,
    ),
    fullAddress: db.string(),
    state: db.string(),
    ...db.fields.timestamps(),
  })
  .hooks({
    create: ({ input }) => ({
      fullAddress: `${input.postalCode} ${input.address} ${input.city}`,
    }),
    update: ({ input }) => ({
      fullAddress: `${input.postalCode} ${input.address} ${input.city}`,
    }),
  })
  .validate(({ newRecord }, issues) => {
    if (newRecord.country === "JP" && !newRecord.postalCode) {
      issues("postalCode", "Postal code is required for Japan");
    }
  })
  .permission(defaultPermission)
  .gqlPermission(defaultGqlPermission);
