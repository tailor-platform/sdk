import { db, t } from "@tailor-platform/tailor-sdk";
import { user } from "./user";

export const userSetting = db.type(
  "UserSetting",
  {
    language: db.enum("jp", "en"),
    userID: db.uuid().ref(user, ["user", "setting"]).unique(),
  },
  { withTimestamps: true },
);
export type userSetting = typeof userSetting;
export type UserSetting = t.infer<userSetting>;
