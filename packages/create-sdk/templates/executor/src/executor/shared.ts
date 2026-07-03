import { getDB } from "../generated/db";
import type { UUIDString } from "@tailor-platform/sdk";

interface AuditLogInput {
  action: string;
  entityType: string;
  entityId: UUIDString;
  message: string;
}

export async function createAuditLog(input: AuditLogInput): Promise<void> {
  const db = getDB("main-db");
  await db.insertInto("AuditLog").values(input).execute();
}
