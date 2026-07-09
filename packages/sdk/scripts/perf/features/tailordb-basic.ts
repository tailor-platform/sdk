/**
 * TailorDB Basic Field Types Performance Test
 *
 * Tests type inference cost for basic field types:
 * string, int, bool, uuid, date, datetime, float, time
 */
import { db } from "../../../src/configure";

export const type0 = db.table("Type0", {
  stringField: db.string(),
  intField: db.int(),
  boolField: db.bool(),
  uuidField: db.uuid(),
  dateField: db.date(),
  datetimeField: db.datetime(),
  floatField: db.float(),
  timeField: db.time(),
});

export const type1 = db.table("Type1", {
  stringField: db.string(),
  intField: db.int(),
  boolField: db.bool(),
  uuidField: db.uuid(),
  dateField: db.date(),
  datetimeField: db.datetime(),
  floatField: db.float(),
  timeField: db.time(),
});

export const type2 = db.table("Type2", {
  stringField: db.string(),
  intField: db.int(),
  boolField: db.bool(),
  uuidField: db.uuid(),
  dateField: db.date(),
  datetimeField: db.datetime(),
  floatField: db.float(),
  timeField: db.time(),
});

export const type3 = db.table("Type3", {
  stringField: db.string(),
  intField: db.int(),
  boolField: db.bool(),
  uuidField: db.uuid(),
  dateField: db.date(),
  datetimeField: db.datetime(),
  floatField: db.float(),
  timeField: db.time(),
});

export const type4 = db.table("Type4", {
  stringField: db.string(),
  intField: db.int(),
  boolField: db.bool(),
  uuidField: db.uuid(),
  dateField: db.date(),
  datetimeField: db.datetime(),
  floatField: db.float(),
  timeField: db.time(),
});

export const type5 = db.table("Type5", {
  stringField: db.string(),
  intField: db.int(),
  boolField: db.bool(),
  uuidField: db.uuid(),
  dateField: db.date(),
  datetimeField: db.datetime(),
  floatField: db.float(),
  timeField: db.time(),
});

export const type6 = db.table("Type6", {
  stringField: db.string(),
  intField: db.int(),
  boolField: db.bool(),
  uuidField: db.uuid(),
  dateField: db.date(),
  datetimeField: db.datetime(),
  floatField: db.float(),
  timeField: db.time(),
});

export const type7 = db.table("Type7", {
  stringField: db.string(),
  intField: db.int(),
  boolField: db.bool(),
  uuidField: db.uuid(),
  dateField: db.date(),
  datetimeField: db.datetime(),
  floatField: db.float(),
  timeField: db.time(),
});

export const type8 = db.table("Type8", {
  stringField: db.string(),
  intField: db.int(),
  boolField: db.bool(),
  uuidField: db.uuid(),
  dateField: db.date(),
  datetimeField: db.datetime(),
  floatField: db.float(),
  timeField: db.time(),
});

export const type9 = db.table("Type9", {
  stringField: db.string(),
  intField: db.int(),
  boolField: db.bool(),
  uuidField: db.uuid(),
  dateField: db.date(),
  datetimeField: db.datetime(),
  floatField: db.float(),
  timeField: db.time(),
});
