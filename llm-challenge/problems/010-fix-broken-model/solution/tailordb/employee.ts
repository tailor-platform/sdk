import { db } from "@tailor-platform/sdk";

export const employee = db.type("Employee", {
  name: db.string(),
  department: db.enum(["engineering", "sales", "marketing", "hr"]),
  salary: db.int().validate([({ value }) => value >= 0, "Salary must be non-negative"]),
  hireDate: db.datetime(),
  isActive: db.bool({ optional: true }),
  ...db.fields.timestamps(),
});

export type employee = typeof employee;
