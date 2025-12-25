/**
 * TailorDB Relation Performance Test
 *
 * Tests type inference cost for relation definitions (n-1, 1-n)
 */
import { db } from "../../../src/configure";

export const targetType = db.type("TargetType", {
  name: db.string(),
});

export const type0 = db.type("Type0", {
  name: db.string(),
  targetId: db.uuid().relation({ type: "n-1", toward: { type: targetType } }),
});

export const type1 = db.type("Type1", {
  name: db.string(),
  targetId: db.uuid().relation({ type: "n-1", toward: { type: targetType } }),
});

export const type2 = db.type("Type2", {
  name: db.string(),
  targetId: db.uuid().relation({ type: "n-1", toward: { type: targetType } }),
});

export const type3 = db.type("Type3", {
  name: db.string(),
  targetId: db.uuid().relation({ type: "n-1", toward: { type: targetType } }),
});

export const type4 = db.type("Type4", {
  name: db.string(),
  targetId: db.uuid().relation({ type: "n-1", toward: { type: targetType } }),
});

export const type5 = db.type("Type5", {
  name: db.string(),
  targetId: db.uuid().relation({ type: "n-1", toward: { type: targetType } }),
});

export const type6 = db.type("Type6", {
  name: db.string(),
  targetId: db.uuid().relation({ type: "n-1", toward: { type: targetType } }),
});

export const type7 = db.type("Type7", {
  name: db.string(),
  targetId: db.uuid().relation({ type: "n-1", toward: { type: targetType } }),
});

export const type8 = db.type("Type8", {
  name: db.string(),
  targetId: db.uuid().relation({ type: "n-1", toward: { type: targetType } }),
});

export const type9 = db.type("Type9", {
  name: db.string(),
  targetId: db.uuid().relation({ type: "n-1", toward: { type: targetType } }),
});
