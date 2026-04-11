/**
 * TailorDB Validation Rules Performance Test
 *
 * Tests type inference cost for record-level validation
 */
import { db } from "../../../src/configure";

export const type0 = db
  .type("Type0", {
    name: db.string(),
    email: db.string(),
    age: db.int(),
  })
  .validate([
    ({ data }) => data.name.length > 0,
    [({ data }) => data.email.includes("@"), "Must be valid email"],
    ({ data }) => data.age >= 0,
  ]);

export const type1 = db
  .type("Type1", {
    name: db.string(),
    email: db.string(),
    age: db.int(),
  })
  .validate([
    ({ data }) => data.name.length > 0,
    [({ data }) => data.email.includes("@"), "Must be valid email"],
    ({ data }) => data.age >= 0,
  ]);

export const type2 = db
  .type("Type2", {
    name: db.string(),
    email: db.string(),
    age: db.int(),
  })
  .validate([
    ({ data }) => data.name.length > 0,
    [({ data }) => data.email.includes("@"), "Must be valid email"],
    ({ data }) => data.age >= 0,
  ]);

export const type3 = db
  .type("Type3", {
    name: db.string(),
    email: db.string(),
    age: db.int(),
  })
  .validate([
    ({ data }) => data.name.length > 0,
    [({ data }) => data.email.includes("@"), "Must be valid email"],
    ({ data }) => data.age >= 0,
  ]);

export const type4 = db
  .type("Type4", {
    name: db.string(),
    email: db.string(),
    age: db.int(),
  })
  .validate([
    ({ data }) => data.name.length > 0,
    [({ data }) => data.email.includes("@"), "Must be valid email"],
    ({ data }) => data.age >= 0,
  ]);

export const type5 = db
  .type("Type5", {
    name: db.string(),
    email: db.string(),
    age: db.int(),
  })
  .validate([
    ({ data }) => data.name.length > 0,
    [({ data }) => data.email.includes("@"), "Must be valid email"],
    ({ data }) => data.age >= 0,
  ]);

export const type6 = db
  .type("Type6", {
    name: db.string(),
    email: db.string(),
    age: db.int(),
  })
  .validate([
    ({ data }) => data.name.length > 0,
    [({ data }) => data.email.includes("@"), "Must be valid email"],
    ({ data }) => data.age >= 0,
  ]);

export const type7 = db
  .type("Type7", {
    name: db.string(),
    email: db.string(),
    age: db.int(),
  })
  .validate([
    ({ data }) => data.name.length > 0,
    [({ data }) => data.email.includes("@"), "Must be valid email"],
    ({ data }) => data.age >= 0,
  ]);

export const type8 = db
  .type("Type8", {
    name: db.string(),
    email: db.string(),
    age: db.int(),
  })
  .validate([
    ({ data }) => data.name.length > 0,
    [({ data }) => data.email.includes("@"), "Must be valid email"],
    ({ data }) => data.age >= 0,
  ]);

export const type9 = db
  .type("Type9", {
    name: db.string(),
    email: db.string(),
    age: db.int(),
  })
  .validate([
    ({ data }) => data.name.length > 0,
    [({ data }) => data.email.includes("@"), "Must be valid email"],
    ({ data }) => data.age >= 0,
  ]);
