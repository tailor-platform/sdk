import { db } from "@tailor-platform/sdk";

export const event = db.type("Event", {
  name: db.string(),
  eventDate: db.date(),
  startTime: db.time(),
  endTime: db.time({ optional: true }),
  capacity: db.int({ optional: true }),
  price: db.float(),
  scheduledAt: db.datetime(),
  ...db.fields.timestamps(),
});

export type event = typeof event;
