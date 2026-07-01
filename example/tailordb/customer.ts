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
    city: db.string({ optional: true }).validate(
      ({ newValue }) =>
        newValue && newValue.length <= 1 ? "City must be longer than 1 character" : undefined,
      ({ newValue }) =>
        newValue && newValue.length >= 100 ? "City must be shorter than 100 characters" : undefined,
    ),
    fullAddress: db.string(),
    state: db.string(),
    ...db.fields.timestamps(),
  })
  .hooks({
    fullAddress: {
      create: ({ newRecord }) => `${newRecord.postalCode} ${newRecord.address} ${newRecord.city}`,
      update: ({ newRecord }) => `${newRecord.postalCode} ${newRecord.address} ${newRecord.city}`,
    },
  })
  .validate({
    name: ({ newValue }) =>
      newValue.length <= 5 ? "Name must be longer than 5 characters" : undefined,
  })
  .validate(({ newRecord }, issues) => {
    if (newRecord.country === "JP" && !newRecord.postalCode) {
      issues("postalCode", "Postal code is required for Japan");
    }
  })
  .permission(defaultPermission)
  .gqlPermission(defaultGqlPermission);
