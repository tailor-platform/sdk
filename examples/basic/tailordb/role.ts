import { db } from "@tailor-platform/tailor-sdk";

export const role = db.type("Role", { name: db.string() });
export type role = typeof role;
