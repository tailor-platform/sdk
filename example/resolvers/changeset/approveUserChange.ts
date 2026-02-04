import { createResolver, t } from "@tailor-platform/sdk";
import {
  buildApprovalUpdate,
  buildStepCompletionUpdate,
  buildRequestStatusUpdate,
  buildAdvanceStepUpdate,
  determineStepStatus,
  isPendingApproval,
  getNextStepNo,
} from "@tailor-platform/sdk/changeset-plugin";
import { getDB } from "../../generated/tailordb";

/**
 * Approve a user change request
 */
export default createResolver({
  name: "approveUserChange",
  description: "Approve a user change request",
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

    // Get current step approvals
    const approvals = await db
      .selectFrom("UserChangeApproval")
      .selectAll()
      .where("request", "=", requestId)
      .where("stepNo", "=", request.currentStepNo)
      .where("iteration", "=", request.reworkIteration)
      .execute();

    // Find this approver's approval record
    const myApproval = approvals.find((a) => a.approver === approverId);
    if (!myApproval) {
      throw new Error("You are not an approver for this step");
    }
    if (myApproval.decision !== "PENDING") {
      throw new Error("You have already made a decision");
    }

    // Update the approval
    const approvalUpdate = buildApprovalUpdate({
      requestId,
      approverId,
      comment: comment ?? undefined,
    });
    await db
      .updateTable("UserChangeApproval")
      .set(approvalUpdate)
      .where("id", "=", myApproval.id)
      .execute();

    // Get the current step
    const currentStep = await db
      .selectFrom("UserChangeStep")
      .selectAll()
      .where("request", "=", requestId)
      .where("stepNo", "=", request.currentStepNo)
      .where("iteration", "=", request.reworkIteration)
      .executeTakeFirstOrThrow();

    // Update approvals list with our new decision
    const updatedApprovals = approvals.map((a) =>
      a.id === myApproval.id ? { ...a, decision: "APPROVED" as const } : a,
    );

    // Determine new step status
    const newStepStatus = determineStepStatus(
      updatedApprovals,
      currentStep.quorumType,
      currentStep.minApprovals ?? undefined,
    );

    let requestCompleted = false;
    let newRequestStatus = request.status;

    // If step is complete
    if (newStepStatus !== "PENDING") {
      // Update step
      const stepUpdate = buildStepCompletionUpdate(newStepStatus);
      await db
        .updateTable("UserChangeStep")
        .set(stepUpdate)
        .where("id", "=", currentStep.id)
        .execute();

      if (newStepStatus === "APPROVED") {
        // Get total steps count
        const totalSteps = await db
          .selectFrom("UserChangeStep")
          .select((eb) => eb.fn.countAll<number>().as("count"))
          .where("request", "=", requestId)
          .where("iteration", "=", request.reworkIteration)
          .executeTakeFirstOrThrow();

        const nextStepNo = getNextStepNo(request.currentStepNo, totalSteps.count);

        if (nextStepNo === null) {
          // All steps complete - approve the request
          const requestUpdate = buildRequestStatusUpdate("APPROVED");
          await db
            .updateTable("UserChangeRequest")
            .set(requestUpdate)
            .where("id", "=", requestId)
            .execute();
          requestCompleted = true;
          newRequestStatus = "APPROVED";
        } else {
          // Advance to next step
          const advanceUpdate = buildAdvanceStepUpdate(nextStepNo);
          await db
            .updateTable("UserChangeRequest")
            .set(advanceUpdate)
            .where("id", "=", requestId)
            .execute();

          // Start the next step
          await db
            .updateTable("UserChangeStep")
            .set({ startedAt: new Date() })
            .where("request", "=", requestId)
            .where("stepNo", "=", nextStepNo)
            .where("iteration", "=", request.reworkIteration)
            .execute();
        }
      }
    }

    return {
      success: true,
      stepStatus: newStepStatus,
      requestStatus: newRequestStatus,
      requestCompleted,
    };
  },
  output: t.object({
    success: t.bool(),
    stepStatus: t.string(),
    requestStatus: t.string(),
    requestCompleted: t.bool(),
  }),
});
