/**
 * TailorDB Relation Performance Test
 *
 * Tests type inference cost for relation definitions (n-1, 1-n)
 */
import { db } from "../../../src/configure";

export const targetType = db.table("TargetType", {
  name: db.string(),
});

export const type0 = db.table("Type0", {
  name: db.string(),
  targetId: db.uuid().relation({ type: "n-1", toward: { type: targetType } }),
});

export const type1 = db.table("Type1", {
  name: db.string(),
  targetId: db.uuid().relation({ type: "n-1", toward: { type: targetType } }),
});

export const type2 = db.table("Type2", {
  name: db.string(),
  targetId: db.uuid().relation({ type: "n-1", toward: { type: targetType } }),
});

export const type3 = db.table("Type3", {
  name: db.string(),
  targetId: db.uuid().relation({ type: "n-1", toward: { type: targetType } }),
});

export const type4 = db.table("Type4", {
  name: db.string(),
  targetId: db.uuid().relation({ type: "n-1", toward: { type: targetType } }),
});

export const type5 = db.table("Type5", {
  name: db.string(),
  targetId: db.uuid().relation({ type: "n-1", toward: { type: targetType } }),
});

export const type6 = db.table("Type6", {
  name: db.string(),
  targetId: db.uuid().relation({ type: "n-1", toward: { type: targetType } }),
});

export const type7 = db.table("Type7", {
  name: db.string(),
  targetId: db.uuid().relation({ type: "n-1", toward: { type: targetType } }),
});

export const type8 = db.table("Type8", {
  name: db.string(),
  targetId: db.uuid().relation({ type: "n-1", toward: { type: targetType } }),
});

export const type9 = db.table("Type9", {
  name: db.string(),
  targetId: db.uuid().relation({ type: "n-1", toward: { type: targetType } }),
});
