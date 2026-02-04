import { createResolver, t } from "@tailor-platform/sdk";
import {
  buildReworkApprovalUpdate,
  buildStepCompletionUpdate,
  buildRequestStatusUpdate,
  buildReworkEvent,
  isPendingApproval,
} from "@tailor-platform/sdk/changeset-plugin";
import { getDB } from "../../generated/tailordb";

/**
 * Request rework for a user change request
 */
export default createResolver({
  name: "requestUserChangeRework",
  description: "Request rework for a user change request",
  operation: "mutation",
  input: {
    requestId: t.string(),
    reason: t.string({ optional: true }),
  },
  body: async (context) => {
    const db = getDB("tailordb");
    const { requestId, reason } = context.input;
    const requestedBy = context.user.id;

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
      .where("approver", "=", requestedBy)
      .executeTakeFirst();

    if (!myApproval) {
      throw new Error("You are not an approver for this step");
    }
    if (myApproval.decision !== "PENDING") {
      throw new Error("You have already made a decision");
    }

    // Update the approval to rework
    const reworkApprovalUpdate = buildReworkApprovalUpdate({
      requestId,
      requestedBy,
      reason: reason ?? undefined,
    });
    await db
      .updateTable("UserChangeApproval")
      .set(reworkApprovalUpdate)
      .where("id", "=", myApproval.id)
      .execute();

    // Update the step to rework
    const stepUpdate = buildStepCompletionUpdate("REWORK");
    await db
      .updateTable("UserChangeStep")
      .set(stepUpdate)
      .where("request", "=", requestId)
      .where("stepNo", "=", request.currentStepNo)
      .where("iteration", "=", request.reworkIteration)
      .execute();

    // Create rework event
    const reworkEvent = buildReworkEvent(
      requestId,
      request.reworkIteration,
      request.currentStepNo,
      { requestId, requestedBy, reason: reason ?? undefined },
    );
    await db.insertInto("UserChangeReworkEvent").values(reworkEvent).execute();

    // Update the request to rework status
    const requestUpdate = buildRequestStatusUpdate("REWORK");
    await db
      .updateTable("UserChangeRequest")
      .set({
        ...requestUpdate,
        reworkIteration: request.reworkIteration + 1,
        currentStepNo: 1,
      })
      .where("id", "=", requestId)
      .execute();

    return {
      success: true,
      requestStatus: "REWORK",
      newIteration: request.reworkIteration + 1,
    };
  },
  output: t.object({
    success: t.bool(),
    requestStatus: t.string(),
    newIteration: t.int(),
  }),
});
