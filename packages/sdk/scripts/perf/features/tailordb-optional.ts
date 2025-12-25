/**
 * TailorDB Optional Field Modifier Performance Test
 *
 * Tests type inference cost for optional field modifiers
 */
import { db } from "../../../src/configure";

export const type0 = db.type("Type0", {
  requiredString: db.string(),
  optionalString: db.string({ optional: true }),
  optionalInt: db.int({ optional: true }),
  optionalBool: db.bool({ optional: true }),
  optionalDate: db.date({ optional: true }),
});

export const type1 = db.type("Type1", {
  requiredString: db.string(),
  optionalString: db.string({ optional: true }),
  optionalInt: db.int({ optional: true }),
  optionalBool: db.bool({ optional: true }),
  optionalDate: db.date({ optional: true }),
});

export const type2 = db.type("Type2", {
  requiredString: db.string(),
  optionalString: db.string({ optional: true }),
  optionalInt: db.int({ optional: true }),
  optionalBool: db.bool({ optional: true }),
  optionalDate: db.date({ optional: true }),
});

export const type3 = db.type("Type3", {
  requiredString: db.string(),
  optionalString: db.string({ optional: true }),
  optionalInt: db.int({ optional: true }),
  optionalBool: db.bool({ optional: true }),
  optionalDate: db.date({ optional: true }),
});

export const type4 = db.type("Type4", {
  requiredString: db.string(),
  optionalString: db.string({ optional: true }),
  optionalInt: db.int({ optional: true }),
  optionalBool: db.bool({ optional: true }),
  optionalDate: db.date({ optional: true }),
});

export const type5 = db.type("Type5", {
  requiredString: db.string(),
  optionalString: db.string({ optional: true }),
  optionalInt: db.int({ optional: true }),
  optionalBool: db.bool({ optional: true }),
  optionalDate: db.date({ optional: true }),
});

export const type6 = db.type("Type6", {
  requiredString: db.string(),
  optionalString: db.string({ optional: true }),
  optionalInt: db.int({ optional: true }),
  optionalBool: db.bool({ optional: true }),
  optionalDate: db.date({ optional: true }),
});

export const type7 = db.type("Type7", {
  requiredString: db.string(),
  optionalString: db.string({ optional: true }),
  optionalInt: db.int({ optional: true }),
  optionalBool: db.bool({ optional: true }),
  optionalDate: db.date({ optional: true }),
});

export const type8 = db.type("Type8", {
  requiredString: db.string(),
  optionalString: db.string({ optional: true }),
  optionalInt: db.int({ optional: true }),
  optionalBool: db.bool({ optional: true }),
  optionalDate: db.date({ optional: true }),
});

export const type9 = db.type("Type9", {
  requiredString: db.string(),
  optionalString: db.string({ optional: true }),
  optionalInt: db.int({ optional: true }),
  optionalBool: db.bool({ optional: true }),
  optionalDate: db.date({ optional: true }),
});
