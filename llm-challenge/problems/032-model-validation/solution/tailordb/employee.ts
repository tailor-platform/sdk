import { db } from "@tailor-platform/sdk";

export const employee = db.type("Employee", {
  name: db
    .string()
    .validate([({ value }) => value.length >= 2, "Name must be at least 2 characters"]),
  age: db
    .int()
    .validate(
      [({ value }) => value >= 18, "Must be at least 18"],
      [({ value }) => value <= 120, "Must be at most 120"],
    ),
  email: db.string(),
  department: db.enum(["engineering", "sales", "marketing", "hr"]),
  ...db.fields.timestamps(),
});

export type employee = typeof employee;
