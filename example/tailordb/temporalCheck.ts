import { db } from "@tailor-platform/sdk";
import { defaultGqlPermission, defaultPermission } from "./permissions";

export const temporalCheck = db
  .table(["TemporalCheck", "TemporalCheckList"], {
    eventDate: db.date(),
    eventDatetime: db.datetime(),
    eventTime: db.time(),
    checkedAt: db.datetime(),
  })
  .permission(defaultPermission)
  .gqlPermission(defaultGqlPermission);
