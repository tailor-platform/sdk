import { createResolver, t } from "@tailor-platform/sdk";
import {
  isPendingApproval,
  isApproved,
  isRejected,
  isCanceled,
  isActivated,
  isDraft,
  isActive,
  isArchived,
} from "@tailor-platform/sdk/changeset-plugin";
import { getDB } from "../../generated/tailordb";

/**
 * Get the status of a user change request
 */
export default createResolver({
  name: "getUserChangeStatus",
  description: "Get the detailed status of a user change request",
  operation: "query",
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

    // Get the draft record
    const draft = await db
      .selectFrom("User")
      .selectAll()
      .where("id", "=", request.draft)
      .executeTakeFirstOrThrow();

    if (!draft.recordState) {
      throw new Error("Draft record state is missing");
    }

    // Get current step
    const currentStep = await db
      .selectFrom("UserChangeStep")
      .selectAll()
      .where("request", "=", requestId)
      .where("stepNo", "=", request.currentStepNo)
      .where("iteration", "=", request.reworkIteration)
      .executeTakeFirst();

    // Get all steps
    const steps = await db
      .selectFrom("UserChangeStep")
      .selectAll()
      .where("request", "=", requestId)
      .where("iteration", "=", request.reworkIteration)
      .orderBy("stepNo", "asc")
      .execute();

    // Get approvals for current step
    const approvals = await db
      .selectFrom("UserChangeApproval")
      .selectAll()
      .where("request", "=", requestId)
      .where("stepNo", "=", request.currentStepNo)
      .where("iteration", "=", request.reworkIteration)
      .execute();

    // Determine status flags using plugin utilities
    const statusFlags = {
      isPendingApproval: isPendingApproval(request),
      isApproved: isApproved(request),
      isRejected: isRejected(request),
      isCanceled: isCanceled(request),
      isActivated: isActivated(request),
      draftIsDraft: isDraft({ recordState: draft.recordState }),
      draftIsActive: isActive({ recordState: draft.recordState }),
      draftIsArchived: isArchived({ recordState: draft.recordState }),
    };

    return {
      requestId: request.id,
      recordId: request.recordId,
      status: request.status,
      activationStatus: request.activationStatus,
      currentStepNo: request.currentStepNo,
      reworkIteration: request.reworkIteration,
      requestedBy: request.requestedBy,
      requestedAt: request.requestedAt.toISOString(),
      effectiveFrom: request.effectiveFrom.toISOString(),
      finalizedAt: request.finalizedAt?.toISOString() ?? null,
      activatedAt: request.activatedAt?.toISOString() ?? null,
      currentStep: currentStep
        ? {
            stepNo: currentStep.stepNo,
            stepName: currentStep.stepName,
            status: currentStep.status,
            quorumType: currentStep.quorumType,
            minApprovals: currentStep.minApprovals,
          }
        : null,
      totalSteps: steps.length,
      approvals: approvals.map((a) => ({
        approver: a.approver,
        decision: a.decision,
        decidedAt: a.decidedAt?.toISOString() ?? null,
        comment: a.comment,
      })),
      statusFlags,
      draft: {
        id: draft.id,
        name: draft.name,
        email: draft.email,
        recordState: draft.recordState,
      },
    };
  },
  output: t.object({
    requestId: t.string(),
    recordId: t.string(),
    status: t.string(),
    activationStatus: t.string(),
    currentStepNo: t.int(),
    reworkIteration: t.int(),
    requestedBy: t.string(),
    requestedAt: t.string(),
    effectiveFrom: t.string(),
    finalizedAt: t.string({ optional: true }),
    activatedAt: t.string({ optional: true }),
    currentStep: t.object(
      {
        stepNo: t.int(),
        stepName: t.string(),
        status: t.string(),
        quorumType: t.string(),
        minApprovals: t.int({ optional: true }),
      },
      { optional: true },
    ),
    totalSteps: t.int(),
    approvals: t.object(
      {
        approver: t.string(),
        decision: t.string(),
        decidedAt: t.string({ optional: true }),
        comment: t.string({ optional: true }),
      },
      { array: true },
    ),
    statusFlags: t.object({
      isPendingApproval: t.bool(),
      isApproved: t.bool(),
      isRejected: t.bool(),
      isCanceled: t.bool(),
      isActivated: t.bool(),
      draftIsDraft: t.bool(),
      draftIsActive: t.bool(),
      draftIsArchived: t.bool(),
    }),
    draft: t.object({
      id: t.string(),
      name: t.string(),
      email: t.string(),
      recordState: t.string(),
    }),
  }),
});
