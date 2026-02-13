import { db } from "@tailor-platform/sdk";

export const employee = db.type("Employee", {
  name: db.string(),
  department: db.string(),
  salary: db.int(),
  hireDate: db.datetime(),
  isActive: db.bool({ optional: true }),
  ...db.fields.timestamps(),
});

export type employee = typeof employee;
