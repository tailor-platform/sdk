import { createResolver, t } from "@tailor-platform/sdk";
import {
  buildChangeRequest,
  buildChangeSteps,
  buildChangeApprovals,
  isDraft,
  type QuorumType,
  type ResolvedByRuleType,
  type SubmitForApprovalOptions,
} from "@tailor-platform/sdk/changeset-plugin";
import { getDB } from "../../generated/tailordb";

/**
 * Submit a user draft for approval
 */
export default createResolver({
  name: "submitUserForApproval",
  description: "Submit a user draft for approval workflow",
  operation: "mutation",
  input: {
    draftId: t.string(),
    effectiveFrom: t.datetime({ optional: true }),
    steps: t.object(
      {
        stepNo: t.int(),
        stepName: t.string(),
        quorumType: t.enum(["ALL", "ANY"]),
        minApprovals: t.int({ optional: true }),
        approvers: t.object(
          {
            approver: t.string(),
            resolvedByRuleType: t.enum(["USER", "GROUP", "ROLE", "ORG_MANAGER"]),
            resolvedByRuleValue: t.string({ optional: true }),
          },
          { array: true },
        ),
      },
      { array: true },
    ),
  },
  body: async (context) => {
    const db = getDB("tailordb");
    const { draftId, effectiveFrom, steps } = context.input;

    // Get the draft record
    const draft = await db
      .selectFrom("User")
      .selectAll()
      .where("id", "=", draftId)
      .executeTakeFirstOrThrow();

    // Verify it's a draft
    if (!isDraft(draft)) {
      throw new Error("Record is not in DRAFT state");
    }

    // Build the change request
    const requestOptions: SubmitForApprovalOptions = {
      draftId: draft.id,
      recordId: draft.recordId,
      templateKey: "user-approval",
      templateVersion: 1,
      requestedBy: context.user.id,
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
      steps: steps.map((step) => ({
        stepNo: step.stepNo,
        stepName: step.stepName,
        quorumType: step.quorumType as QuorumType,
        minApprovals: step.minApprovals ?? undefined,
        approvers: step.approvers.map((a) => ({
          approver: a.approver,
          resolvedByRuleType: a.resolvedByRuleType as ResolvedByRuleType,
          resolvedByRuleValue: a.resolvedByRuleValue ?? undefined,
        })),
      })),
    };

    const changeRequest = buildChangeRequest(requestOptions);
    const changeSteps = buildChangeSteps(changeRequest.id, requestOptions);
    const changeApprovals = buildChangeApprovals(changeRequest.id, requestOptions);

    // Insert change request
    await db.insertInto("UserChangeRequest").values(changeRequest).execute();

    // Insert change steps
    if (changeSteps.length > 0) {
      await db.insertInto("UserChangeStep").values(changeSteps).execute();
    }

    // Insert change approvals
    if (changeApprovals.length > 0) {
      await db.insertInto("UserChangeApproval").values(changeApprovals).execute();
    }

    // Update draft with current approver
    const firstStepApprovers = steps[0]?.approvers.map((a) => a.approver) ?? [];
    await db
      .updateTable("User")
      .set({
        currentApprover: firstStepApprovers[0],
        approvers: firstStepApprovers,
      })
      .where("id", "=", draftId)
      .execute();

    return {
      requestId: changeRequest.id,
      status: changeRequest.status,
      currentStepNo: changeRequest.currentStepNo,
    };
  },
  output: t.object({
    requestId: t.string(),
    status: t.string(),
    currentStepNo: t.int(),
  }),
});
