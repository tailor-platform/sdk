import { db } from "@tailor-platform/sdk";
import { user } from "./user";

export const profile = db.type("Profile", {
  userId: db.uuid().relation({
    type: "1-1",
    toward: {
      type: user,
      as: "owner",
    },
    backward: "profile",
  }),
  bio: db.string({ optional: true }),
  avatarUrl: db.string({ optional: true }),
  ...db.fields.timestamps(),
});

export type profile = typeof profile;
