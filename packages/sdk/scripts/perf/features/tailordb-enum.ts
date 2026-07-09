/**
 * TailorDB Enum Field Types Performance Test
 *
 * Tests type inference cost for enum field definitions
 */
import { db } from "../../../src/configure";

export const type0 = db.table("Type0", {
  name: db.string(),
  status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
  priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: db.enum(["A", "B", "C", "D", "E"]),
});

export const type1 = db.table("Type1", {
  name: db.string(),
  status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
  priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: db.enum(["A", "B", "C", "D", "E"]),
});

export const type2 = db.table("Type2", {
  name: db.string(),
  status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
  priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: db.enum(["A", "B", "C", "D", "E"]),
});

export const type3 = db.table("Type3", {
  name: db.string(),
  status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
  priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: db.enum(["A", "B", "C", "D", "E"]),
});

export const type4 = db.table("Type4", {
  name: db.string(),
  status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
  priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: db.enum(["A", "B", "C", "D", "E"]),
});

export const type5 = db.table("Type5", {
  name: db.string(),
  status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
  priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: db.enum(["A", "B", "C", "D", "E"]),
});

export const type6 = db.table("Type6", {
  name: db.string(),
  status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
  priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: db.enum(["A", "B", "C", "D", "E"]),
});

export const type7 = db.table("Type7", {
  name: db.string(),
  status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
  priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: db.enum(["A", "B", "C", "D", "E"]),
});

export const type8 = db.table("Type8", {
  name: db.string(),
  status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
  priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: db.enum(["A", "B", "C", "D", "E"]),
});

export const type9 = db.table("Type9", {
  name: db.string(),
  status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
  priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: db.enum(["A", "B", "C", "D", "E"]),
});
