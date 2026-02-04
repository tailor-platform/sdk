import { createResolver, t } from "@tailor-platform/sdk";
import {
  buildActivationUpdate,
  buildRecordActivationUpdate,
  buildArchiveUpdate,
  isApproved,
  isActivated,
} from "@tailor-platform/sdk/changeset-plugin";
import { getDB } from "../../generated/tailordb";

/**
 * Activate an approved user change request
 */
export default createResolver({
  name: "activateUserChange",
  description: "Activate an approved user change, making the draft the active record",
  operation: "mutation",
  input: {
    requestId: t.string(),
  },
  body: async (context) => {
    const db = getDB("tailordb");
    const { requestId } = context.input;

    // Get the change request
    const request = await db
      .selectFrom("UserChangeRequest")
      .selectAll()
      .where("id", "=", requestId)
      .executeTakeFirstOrThrow();

    // Verify the request is approved
    if (!isApproved(request)) {
      throw new Error("Request is not approved");
    }

    // Verify the request is not already activated
    if (isActivated(request)) {
      throw new Error("Request is already activated");
    }

    // Check if effective date has passed
    if (new Date(request.effectiveFrom) > new Date()) {
      throw new Error("Effective date has not yet passed");
    }

    // Find the current active record for this recordId (if exists)
    const currentActive = await db
      .selectFrom("User")
      .selectAll()
      .where("recordId", "=", request.recordId)
      .where("recordState", "=", "ACTIVE")
      .executeTakeFirst();

    // If there's a current active record, archive it
    if (currentActive) {
      // Get max archived sequence for this record
      const maxSeqResult = await db
        .selectFrom("User")
        .select((eb) => eb.fn.max("archivedSeq").as("maxSeq"))
        .where("recordId", "=", request.recordId)
        .where("recordState", "=", "ARCHIVED")
        .executeTakeFirst();

      const nextSeq = (maxSeqResult?.maxSeq ?? 0) + 1;

      // Archive the current active record
      const archiveUpdate = buildArchiveUpdate(nextSeq);
      await db.updateTable("User").set(archiveUpdate).where("id", "=", currentActive.id).execute();
    }

    // Activate the draft record
    const recordActivationUpdate = buildRecordActivationUpdate();
    await db
      .updateTable("User")
      .set({
        ...recordActivationUpdate,
        currentApprover: null,
        approvers: [],
      })
      .where("id", "=", request.draft)
      .execute();

    // Update the change request as activated
    const activationUpdate = buildActivationUpdate();
    await db
      .updateTable("UserChangeRequest")
      .set(activationUpdate)
      .where("id", "=", requestId)
      .execute();

    return {
      success: true,
      activatedRecordId: request.draft,
      archivedRecordId: currentActive?.id ?? null,
    };
  },
  output: t.object({
    success: t.bool(),
    activatedRecordId: t.string(),
    archivedRecordId: t.string({ optional: true }),
  }),
});
