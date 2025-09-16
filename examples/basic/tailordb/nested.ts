import { db } from "@tailor-platform/tailor-sdk";
import {
  defaultGqlPermission,
  defaultPermission,
  PermissionUser,
} from "./permissions";

export const nestedProfile = db
  .type("NestedProfile", {
    userInfo: db.object({
      personal: db.object({
        name: db.string(),
        age: db.int({ optional: true }),
        bio: db.string({ optional: true }),
      }),
      contact: db.object({
        email: db.string(),
        phone: db.string({ optional: true }),
        address: db.object({
          street: db.string(),
          city: db.string(),
          country: db.string(),
          coordinates: db.object(
            {
              latitude: db.float(),
              longitude: db.float(),
            },
            { optional: true },
          ),
        }),
      }),
      preferences: db.object(
        {
          notifications: db.object({
            email: db.bool(),
            sms: db.bool(),
            push: db.bool(),
          }),
          privacy: db.object(
            {
              profileVisible: db.bool(),
              dataSharing: db.bool(),
            },
            { optional: true },
          ),
        },
        { optional: true },
      ),
    }),
    metadata: db.object({
      created: db.datetime(),
      lastUpdated: db.datetime({ optional: true }),
      version: db.int(),
    }),
    archived: db.bool({ optional: true }),
  })
  .permission<PermissionUser>(defaultPermission)
  .gqlPermission<PermissionUser>(defaultGqlPermission);
