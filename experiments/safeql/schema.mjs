import { db } from "../../packages/sdk/src/configure/services/tailordb/index.ts";
import { stripTailorDBTypeBuilderHelpers } from "../../packages/sdk/src/parser/service/tailordb/builder-helpers.ts";
import { TailorDBTypeSchema } from "../../packages/sdk/src/parser/service/tailordb/schema.ts";
import { parseTypes } from "../../packages/sdk/src/parser/service/tailordb/type-parser.ts";

export const account = db.table("Account", {
  email: db.string(),
  nickname: db.string({ optional: true }),
  age: db.int(),
  active: db.bool(),
  score: db.float(),
  balance: db.decimal(),
  birthday: db.date({ optional: true }),
  createdAt: db.datetime(),
  role: db.enum(["ADMIN", "MEMBER"]),
});

export const project = db.table("Project", {
  ownerId: db.uuid(),
  title: db.string(),
  budget: db.decimal(),
});

export function parseTables(definitions, namespace) {
  const rawTypes = Object.fromEntries(
    definitions.map((table) => [
      table.name,
      TailorDBTypeSchema.parse(stripTailorDBTypeBuilderHelpers(table)),
    ]),
  );
  return parseTypes(rawTypes, namespace);
}
