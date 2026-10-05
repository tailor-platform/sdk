import { createResolver, t } from "@tailor-platform/sdk";
import { Temporal } from "@tailor-platform/sdk/runtime";
import { getDB } from "../generated/tailordb";

export default createResolver({
  name: "temporalRoundTrip",
  description: "Insert and read back a TemporalCheck row to verify Temporal round-trip",
  operation: "mutation",
  input: {},
  output: t.object({
    id: t.string(),
    eventDateIsTemporal: t.bool(),
    eventDatetimeIsTemporal: t.bool(),
    eventTimeIsTemporal: t.bool(),
    eventDateString: t.string(),
    eventDatetimeString: t.string(),
    eventTimeString: t.string(),
  }),
  body: async () => {
    const db = getDB("tailordb");

    const eventDate = Temporal.PlainDate.from("2026-03-14");
    const eventDatetime = Temporal.Instant.from("2026-03-14T09:30:00Z");
    const eventTime = Temporal.PlainTime.from("09:30:00");

    const inserted = await db
      .insertInto("TemporalCheck")
      .values({ eventDate, eventDatetime, eventTime, checkedAt: Temporal.Now.instant() })
      .returning("id")
      .executeTakeFirstOrThrow();

    const selected = await db
      .selectFrom("TemporalCheck")
      .selectAll()
      .where("id", "=", inserted.id)
      .executeTakeFirstOrThrow();

    return {
      id: selected.id,
      eventDateIsTemporal: selected.eventDate instanceof Temporal.PlainDate,
      eventDatetimeIsTemporal: selected.eventDatetime instanceof Temporal.Instant,
      eventTimeIsTemporal: selected.eventTime instanceof Temporal.PlainTime,
      eventDateString: selected.eventDate.toString(),
      eventDatetimeString: selected.eventDatetime.toString(),
      eventTimeString: selected.eventTime.toString(),
    };
  },
});
