import { db } from "@tailor-platform/tailor-sdk";
import { user } from "./user";

export const userSetting = db.type("UserSetting", {
  language: db.enum("jp", "en"),
  userID: db.uuid().relation({
    type: "1-1",
    toward: { type: user },
    backward: "setting",
  }),
  ...db.fields.timestamps(),
});
export type userSetting = typeof userSetting;
