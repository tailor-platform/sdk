/**
 * TailorDB Enum Field Types Performance Test
 *
 * Tests type inference cost for enum field definitions
 */
import { db } from "../../../src/configure";

export const type0 = db.type("Type0", {
  name: db.string(),
  status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
  priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: db.enum(["A", "B", "C", "D", "E"]),
});

export const type1 = db.type("Type1", {
  name: db.string(),
  status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
  priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: db.enum(["A", "B", "C", "D", "E"]),
});

export const type2 = db.type("Type2", {
  name: db.string(),
  status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
  priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: db.enum(["A", "B", "C", "D", "E"]),
});

export const type3 = db.type("Type3", {
  name: db.string(),
  status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
  priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: db.enum(["A", "B", "C", "D", "E"]),
});

export const type4 = db.type("Type4", {
  name: db.string(),
  status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
  priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: db.enum(["A", "B", "C", "D", "E"]),
});

export const type5 = db.type("Type5", {
  name: db.string(),
  status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
  priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: db.enum(["A", "B", "C", "D", "E"]),
});

export const type6 = db.type("Type6", {
  name: db.string(),
  status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
  priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: db.enum(["A", "B", "C", "D", "E"]),
});

export const type7 = db.type("Type7", {
  name: db.string(),
  status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
  priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: db.enum(["A", "B", "C", "D", "E"]),
});

export const type8 = db.type("Type8", {
  name: db.string(),
  status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
  priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: db.enum(["A", "B", "C", "D", "E"]),
});

export const type9 = db.type("Type9", {
  name: db.string(),
  status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
  priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: db.enum(["A", "B", "C", "D", "E"]),
});
