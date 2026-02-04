import { createResolver, t } from "@tailor-platform/sdk";
import {
  buildRejectionUpdate,
  buildStepCompletionUpdate,
  buildRequestStatusUpdate,
  isPendingApproval,
} from "@tailor-platform/sdk/changeset-plugin";
import { getDB } from "../../generated/tailordb";

/**
 * Reject a user change request
 */
export default createResolver({
  name: "rejectUserChange",
  description: "Reject a user change request",
  operation: "mutation",
  input: {
    requestId: t.string(),
    comment: t.string({ optional: true }),
  },
  body: async (context) => {
    const db = getDB("tailordb");
    const { requestId, comment } = context.input;
    const approverId = context.user.id;

    // Get the change request
    const request = await db
      .selectFrom("UserChangeRequest")
      .selectAll()
      .where("id", "=", requestId)
      .executeTakeFirstOrThrow();

    // Verify the request is pending approval
    if (!isPendingApproval(request)) {
      throw new Error("Request is not pending approval");
    }

    // Find this approver's approval record for current step
    const myApproval = await db
      .selectFrom("UserChangeApproval")
      .selectAll()
      .where("request", "=", requestId)
      .where("stepNo", "=", request.currentStepNo)
      .where("iteration", "=", request.reworkIteration)
      .where("approver", "=", approverId)
      .executeTakeFirst();

    if (!myApproval) {
      throw new Error("You are not an approver for this step");
    }
    if (myApproval.decision !== "PENDING") {
      throw new Error("You have already made a decision");
    }

    // Update the approval to rejected
    const rejectionUpdate = buildRejectionUpdate({
      requestId,
      approverId,
      comment: comment ?? undefined,
    });
    await db
      .updateTable("UserChangeApproval")
      .set(rejectionUpdate)
      .where("id", "=", myApproval.id)
      .execute();

    // Update the step to rejected
    const stepUpdate = buildStepCompletionUpdate("REJECTED");
    await db
      .updateTable("UserChangeStep")
      .set(stepUpdate)
      .where("request", "=", requestId)
      .where("stepNo", "=", request.currentStepNo)
      .where("iteration", "=", request.reworkIteration)
      .execute();

    // Update the request to rejected
    const requestUpdate = buildRequestStatusUpdate("REJECTED");
    await db
      .updateTable("UserChangeRequest")
      .set(requestUpdate)
      .where("id", "=", requestId)
      .execute();

    // Update the draft record
    await db
      .updateTable("User")
      .set({
        currentApprover: null,
        approvers: [],
      })
      .where("id", "=", request.draft)
      .execute();

    return {
      success: true,
      requestStatus: "REJECTED",
    };
  },
  output: t.object({
    success: t.bool(),
    requestStatus: t.string(),
  }),
});
