/**
 * TailorDB Validation Rules Performance Test
 *
 * Tests type inference cost for field validation
 */
import { db } from "../../../src/configure";

export const type0 = db.type("Type0", {
  name: db.string().validate(({ value }) => (value.length <= 0 ? "Must not be empty" : undefined)),
  email: db
    .string()
    .validate(({ value }) => (!value.includes("@") ? "Must be valid email" : undefined)),
  age: db.int().validate(({ value }) => (value < 0 ? "Must be non-negative" : undefined)),
});

export const type1 = db.type("Type1", {
  name: db.string().validate(({ value }) => (value.length <= 0 ? "Must not be empty" : undefined)),
  email: db
    .string()
    .validate(({ value }) => (!value.includes("@") ? "Must be valid email" : undefined)),
  age: db.int().validate(({ value }) => (value < 0 ? "Must be non-negative" : undefined)),
});

export const type2 = db.type("Type2", {
  name: db.string().validate(({ value }) => (value.length <= 0 ? "Must not be empty" : undefined)),
  email: db
    .string()
    .validate(({ value }) => (!value.includes("@") ? "Must be valid email" : undefined)),
  age: db.int().validate(({ value }) => (value < 0 ? "Must be non-negative" : undefined)),
});

export const type3 = db.type("Type3", {
  name: db.string().validate(({ value }) => (value.length <= 0 ? "Must not be empty" : undefined)),
  email: db
    .string()
    .validate(({ value }) => (!value.includes("@") ? "Must be valid email" : undefined)),
  age: db.int().validate(({ value }) => (value < 0 ? "Must be non-negative" : undefined)),
});

export const type4 = db.type("Type4", {
  name: db.string().validate(({ value }) => (value.length <= 0 ? "Must not be empty" : undefined)),
  email: db
    .string()
    .validate(({ value }) => (!value.includes("@") ? "Must be valid email" : undefined)),
  age: db.int().validate(({ value }) => (value < 0 ? "Must be non-negative" : undefined)),
});

export const type5 = db.type("Type5", {
  name: db.string().validate(({ value }) => (value.length <= 0 ? "Must not be empty" : undefined)),
  email: db
    .string()
    .validate(({ value }) => (!value.includes("@") ? "Must be valid email" : undefined)),
  age: db.int().validate(({ value }) => (value < 0 ? "Must be non-negative" : undefined)),
});

export const type6 = db.type("Type6", {
  name: db.string().validate(({ value }) => (value.length <= 0 ? "Must not be empty" : undefined)),
  email: db
    .string()
    .validate(({ value }) => (!value.includes("@") ? "Must be valid email" : undefined)),
  age: db.int().validate(({ value }) => (value < 0 ? "Must be non-negative" : undefined)),
});

export const type7 = db.type("Type7", {
  name: db.string().validate(({ value }) => (value.length <= 0 ? "Must not be empty" : undefined)),
  email: db
    .string()
    .validate(({ value }) => (!value.includes("@") ? "Must be valid email" : undefined)),
  age: db.int().validate(({ value }) => (value < 0 ? "Must be non-negative" : undefined)),
});

export const type8 = db.type("Type8", {
  name: db.string().validate(({ value }) => (value.length <= 0 ? "Must not be empty" : undefined)),
  email: db
    .string()
    .validate(({ value }) => (!value.includes("@") ? "Must be valid email" : undefined)),
  age: db.int().validate(({ value }) => (value < 0 ? "Must be non-negative" : undefined)),
});

export const type9 = db.type("Type9", {
  name: db.string().validate(({ value }) => (value.length <= 0 ? "Must not be empty" : undefined)),
  email: db
    .string()
    .validate(({ value }) => (!value.includes("@") ? "Must be valid email" : undefined)),
  age: db.int().validate(({ value }) => (value < 0 ? "Must be non-negative" : undefined)),
});
