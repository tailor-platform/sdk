import { db } from "@tailor-platform/tailor-sdk";
import {
  defaultGqlPermission,
  defaultPermission,
  PermissionUser,
} from "./permissions";

export const customer = db
  .type("Customer", "カスタマー", {
    name: db.string(),
    email: db.string(),
    phone: db.string().optional(),
    country: db.string(),
    postalCode: db.string(),
    address: db.string().optional(),
    city: db
      .string()
      .optional()
      .validate(
        ({ value }) => (value ? value.length > 1 : true),
        ({ value }) => (value ? value.length < 100 : true),
      ),
    fullAddress: db.string().optional(),
    state: db.string(),
    ...db.fields.timestamps(),
  })
  .hooks({
    fullAddress: {
      create: ({ data }) => `〒${data.postalCode} ${data.address} ${data.city}`,
      update: ({ data }) => `〒${data.postalCode} ${data.address} ${data.city}`,
    },
  })
  .validate({
    name: [
      ({ value }) => value.length > 5,
      "Name must be longer than 5 characters",
    ],
  })
  .permission<PermissionUser>(defaultPermission)
  .gqlPermission<PermissionUser>(defaultGqlPermission);
export type customer = typeof customer;
