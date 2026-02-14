import { db } from "@tailor-platform/sdk";

export const employee = db.type("Employe", {
  name: db.string(),
  department: db.str(),
  salary: db.integer(),
  hireDate: db.date(),
  isActive: db.bool({ optional: true }),
  ...db.fields.timestamps(),
});
