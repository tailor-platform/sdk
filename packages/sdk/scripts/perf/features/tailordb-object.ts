/**
 * TailorDB Nested Object Fields Performance Test
 *
 * Tests type inference cost for nested object field types
 */
import { db } from "../../../src/configure";

export const type0 = db.type("Type0", {
  name: db.string(),
  address: db.object({
    street: db.string(),
    city: db.string(),
    country: db.string(),
    zip: db.string({ optional: true }),
  }),
  metadata: db.object({
    tags: db.string({ optional: true }),
    priority: db.int({ optional: true }),
  }),
});

export const type1 = db.type("Type1", {
  name: db.string(),
  address: db.object({
    street: db.string(),
    city: db.string(),
    country: db.string(),
    zip: db.string({ optional: true }),
  }),
  metadata: db.object({
    tags: db.string({ optional: true }),
    priority: db.int({ optional: true }),
  }),
});

export const type2 = db.type("Type2", {
  name: db.string(),
  address: db.object({
    street: db.string(),
    city: db.string(),
    country: db.string(),
    zip: db.string({ optional: true }),
  }),
  metadata: db.object({
    tags: db.string({ optional: true }),
    priority: db.int({ optional: true }),
  }),
});

export const type3 = db.type("Type3", {
  name: db.string(),
  address: db.object({
    street: db.string(),
    city: db.string(),
    country: db.string(),
    zip: db.string({ optional: true }),
  }),
  metadata: db.object({
    tags: db.string({ optional: true }),
    priority: db.int({ optional: true }),
  }),
});

export const type4 = db.type("Type4", {
  name: db.string(),
  address: db.object({
    street: db.string(),
    city: db.string(),
    country: db.string(),
    zip: db.string({ optional: true }),
  }),
  metadata: db.object({
    tags: db.string({ optional: true }),
    priority: db.int({ optional: true }),
  }),
});

export const type5 = db.type("Type5", {
  name: db.string(),
  address: db.object({
    street: db.string(),
    city: db.string(),
    country: db.string(),
    zip: db.string({ optional: true }),
  }),
  metadata: db.object({
    tags: db.string({ optional: true }),
    priority: db.int({ optional: true }),
  }),
});

export const type6 = db.type("Type6", {
  name: db.string(),
  address: db.object({
    street: db.string(),
    city: db.string(),
    country: db.string(),
    zip: db.string({ optional: true }),
  }),
  metadata: db.object({
    tags: db.string({ optional: true }),
    priority: db.int({ optional: true }),
  }),
});

export const type7 = db.type("Type7", {
  name: db.string(),
  address: db.object({
    street: db.string(),
    city: db.string(),
    country: db.string(),
    zip: db.string({ optional: true }),
  }),
  metadata: db.object({
    tags: db.string({ optional: true }),
    priority: db.int({ optional: true }),
  }),
});

export const type8 = db.type("Type8", {
  name: db.string(),
  address: db.object({
    street: db.string(),
    city: db.string(),
    country: db.string(),
    zip: db.string({ optional: true }),
  }),
  metadata: db.object({
    tags: db.string({ optional: true }),
    priority: db.int({ optional: true }),
  }),
});

export const type9 = db.type("Type9", {
  name: db.string(),
  address: db.object({
    street: db.string(),
    city: db.string(),
    country: db.string(),
    zip: db.string({ optional: true }),
  }),
  metadata: db.object({
    tags: db.string({ optional: true }),
    priority: db.int({ optional: true }),
  }),
});
