/**
 * TailorDB Optional Field Modifier Performance Test
 *
 * Tests type inference cost for optional field modifiers
 */
import { db } from "../../../src/configure";

export const type0 = db.table("Type0", {
  requiredString: db.string(),
  optionalString: db.string({ optional: true }),
  optionalInt: db.int({ optional: true }),
  optionalBool: db.bool({ optional: true }),
  optionalDate: db.date({ optional: true }),
});

export const type1 = db.table("Type1", {
  requiredString: db.string(),
  optionalString: db.string({ optional: true }),
  optionalInt: db.int({ optional: true }),
  optionalBool: db.bool({ optional: true }),
  optionalDate: db.date({ optional: true }),
});

export const type2 = db.table("Type2", {
  requiredString: db.string(),
  optionalString: db.string({ optional: true }),
  optionalInt: db.int({ optional: true }),
  optionalBool: db.bool({ optional: true }),
  optionalDate: db.date({ optional: true }),
});

export const type3 = db.table("Type3", {
  requiredString: db.string(),
  optionalString: db.string({ optional: true }),
  optionalInt: db.int({ optional: true }),
  optionalBool: db.bool({ optional: true }),
  optionalDate: db.date({ optional: true }),
});

export const type4 = db.table("Type4", {
  requiredString: db.string(),
  optionalString: db.string({ optional: true }),
  optionalInt: db.int({ optional: true }),
  optionalBool: db.bool({ optional: true }),
  optionalDate: db.date({ optional: true }),
});

export const type5 = db.table("Type5", {
  requiredString: db.string(),
  optionalString: db.string({ optional: true }),
  optionalInt: db.int({ optional: true }),
  optionalBool: db.bool({ optional: true }),
  optionalDate: db.date({ optional: true }),
});

export const type6 = db.table("Type6", {
  requiredString: db.string(),
  optionalString: db.string({ optional: true }),
  optionalInt: db.int({ optional: true }),
  optionalBool: db.bool({ optional: true }),
  optionalDate: db.date({ optional: true }),
});

export const type7 = db.table("Type7", {
  requiredString: db.string(),
  optionalString: db.string({ optional: true }),
  optionalInt: db.int({ optional: true }),
  optionalBool: db.bool({ optional: true }),
  optionalDate: db.date({ optional: true }),
});

export const type8 = db.table("Type8", {
  requiredString: db.string(),
  optionalString: db.string({ optional: true }),
  optionalInt: db.int({ optional: true }),
  optionalBool: db.bool({ optional: true }),
  optionalDate: db.date({ optional: true }),
});

export const type9 = db.table("Type9", {
  requiredString: db.string(),
  optionalString: db.string({ optional: true }),
  optionalInt: db.int({ optional: true }),
  optionalBool: db.bool({ optional: true }),
  optionalDate: db.date({ optional: true }),
});
