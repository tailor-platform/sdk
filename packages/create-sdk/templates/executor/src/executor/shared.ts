import { getDB } from "../generated/db";

interface AuditLogInput {
  action: string;
  entityType: string;
  entityId: string;
  message: string;
}

export async function createAuditLog(input: AuditLogInput): Promise<void> {
  const db = getDB("main-db");
  await db
    .insertInto("AuditLog")
    .values({ ...input, createdAt: new Date(), updatedAt: new Date() })
    .execute();
}
