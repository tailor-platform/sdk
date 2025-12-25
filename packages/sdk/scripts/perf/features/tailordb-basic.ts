/**
 * TailorDB Basic Field Types Performance Test
 *
 * Tests type inference cost for basic field types:
 * string, int, bool, uuid, date, datetime, float, time
 */
import { db } from "../../../src/configure";

export const type0 = db.type("Type0", {
  stringField: db.string(),
  intField: db.int(),
  boolField: db.bool(),
  uuidField: db.uuid(),
  dateField: db.date(),
  datetimeField: db.datetime(),
  floatField: db.float(),
  timeField: db.time(),
});

export const type1 = db.type("Type1", {
  stringField: db.string(),
  intField: db.int(),
  boolField: db.bool(),
  uuidField: db.uuid(),
  dateField: db.date(),
  datetimeField: db.datetime(),
  floatField: db.float(),
  timeField: db.time(),
});

export const type2 = db.type("Type2", {
  stringField: db.string(),
  intField: db.int(),
  boolField: db.bool(),
  uuidField: db.uuid(),
  dateField: db.date(),
  datetimeField: db.datetime(),
  floatField: db.float(),
  timeField: db.time(),
});

export const type3 = db.type("Type3", {
  stringField: db.string(),
  intField: db.int(),
  boolField: db.bool(),
  uuidField: db.uuid(),
  dateField: db.date(),
  datetimeField: db.datetime(),
  floatField: db.float(),
  timeField: db.time(),
});

export const type4 = db.type("Type4", {
  stringField: db.string(),
  intField: db.int(),
  boolField: db.bool(),
  uuidField: db.uuid(),
  dateField: db.date(),
  datetimeField: db.datetime(),
  floatField: db.float(),
  timeField: db.time(),
});

export const type5 = db.type("Type5", {
  stringField: db.string(),
  intField: db.int(),
  boolField: db.bool(),
  uuidField: db.uuid(),
  dateField: db.date(),
  datetimeField: db.datetime(),
  floatField: db.float(),
  timeField: db.time(),
});

export const type6 = db.type("Type6", {
  stringField: db.string(),
  intField: db.int(),
  boolField: db.bool(),
  uuidField: db.uuid(),
  dateField: db.date(),
  datetimeField: db.datetime(),
  floatField: db.float(),
  timeField: db.time(),
});

export const type7 = db.type("Type7", {
  stringField: db.string(),
  intField: db.int(),
  boolField: db.bool(),
  uuidField: db.uuid(),
  dateField: db.date(),
  datetimeField: db.datetime(),
  floatField: db.float(),
  timeField: db.time(),
});

export const type8 = db.type("Type8", {
  stringField: db.string(),
  intField: db.int(),
  boolField: db.bool(),
  uuidField: db.uuid(),
  dateField: db.date(),
  datetimeField: db.datetime(),
  floatField: db.float(),
  timeField: db.time(),
});

export const type9 = db.type("Type9", {
  stringField: db.string(),
  intField: db.int(),
  boolField: db.bool(),
  uuidField: db.uuid(),
  dateField: db.date(),
  datetimeField: db.datetime(),
  floatField: db.float(),
  timeField: db.time(),
});
