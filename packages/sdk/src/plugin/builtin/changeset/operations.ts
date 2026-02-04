/**
 * Changeset plugin operations.
 *
 * These functions provide utilities for working with changeset-managed records.
 * They are designed to be used with Kysely query builder.
 */

import type {
  RecordState,
  ChangeRequestStatus,
  ChangeStepStatus,
  ActivationStatus,
  ApprovalDecision,
  ChangesetRecordFields,
  SubmitForApprovalOptions,
  ApproveOptions,
  RejectOptions,
  RequestReworkOptions,
} from "./types";

/**
 * Generate a new UUID
 * @returns A new UUID string
 */
function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Get the current timestamp
 * @returns Current date
 */
function now(): Date {
  return new Date();
}

/**
 * Build changeset fields for a new draft record
 * @param options - Options for creating the draft
 * @param options.requestedBy
 * @param options.effectiveFrom
 * @returns Changeset fields to merge into the record
 */
export function buildDraftFields(options: {
  requestedBy: string;
  effectiveFrom?: Date;
}): ChangesetRecordFields {
  const timestamp = now();
  return {
    recordId: generateUUID(),
    recordState: "DRAFT" as RecordState,
    archivedSeq: 0,
    effectiveFrom: options.effectiveFrom ?? timestamp,
    effectiveTo: undefined,
    requestedBy: options.requestedBy,
    requestedAt: timestamp,
    currentApprover: undefined,
    approvers: [],
  };
}

/**
 * Build a change request record for insertion
 * @param options - Options for the change request
 * @returns Change request record data
 */
export function buildChangeRequest(options: SubmitForApprovalOptions): {
  id: string;
  recordId: string;
  draft: string;
  status: ChangeRequestStatus;
  reworkIteration: number;
  currentStepNo: number;
  templateKey: string;
  templateVersion: number;
  requestedBy: string;
  requestedAt: Date;
  effectiveFrom: Date;
  activationStatus: ActivationStatus;
} {
  return {
    id: generateUUID(),
    recordId: options.recordId,
    draft: options.draftId,
    status: "RUNNING",
    reworkIteration: 0,
    currentStepNo: 1,
    templateKey: options.templateKey,
    templateVersion: options.templateVersion,
    requestedBy: options.requestedBy,
    requestedAt: now(),
    effectiveFrom: options.effectiveFrom,
    activationStatus: "PENDING",
  };
}

/**
 * Build change step records for insertion
 * @param requestId - The change request ID
 * @param options - Options containing step configurations
 * @returns Array of change step record data
 */
export function buildChangeSteps(
  requestId: string,
  options: SubmitForApprovalOptions,
): Array<{
  id: string;
  request: string;
  iteration: number;
  stepNo: number;
  stepName: string;
  quorumType: string;
  minApprovals: number | undefined;
  status: ChangeStepStatus;
  startedAt: Date;
}> {
  const timestamp = now();
  return options.steps.map((step, index) => ({
    id: generateUUID(),
    request: requestId,
    iteration: 0,
    stepNo: step.stepNo,
    stepName: step.stepName,
    quorumType: step.quorumType,
    minApprovals: step.minApprovals,
    status: index === 0 ? ("PENDING" as ChangeStepStatus) : ("PENDING" as ChangeStepStatus),
    startedAt: index === 0 ? timestamp : timestamp,
  }));
}

/**
 * Build change approval records for insertion
 * @param requestId - The change request ID
 * @param options - Options containing step configurations
 * @returns Array of change approval record data
 */
export function buildChangeApprovals(
  requestId: string,
  options: SubmitForApprovalOptions,
): Array<{
  id: string;
  request: string;
  iteration: number;
  stepNo: number;
  approver: string;
  decision: ApprovalDecision;
  resolvedByRuleType: string;
  resolvedByRuleValue: string | undefined;
}> {
  const approvals: Array<{
    id: string;
    request: string;
    iteration: number;
    stepNo: number;
    approver: string;
    decision: ApprovalDecision;
    resolvedByRuleType: string;
    resolvedByRuleValue: string | undefined;
  }> = [];

  for (const step of options.steps) {
    for (const approver of step.approvers) {
      approvals.push({
        id: generateUUID(),
        request: requestId,
        iteration: 0,
        stepNo: step.stepNo,
        approver: approver.approver,
        decision: "PENDING",
        resolvedByRuleType: approver.resolvedByRuleType,
        resolvedByRuleValue: approver.resolvedByRuleValue,
      });
    }
  }

  return approvals;
}

/**
 * Check if all required approvals for a step are complete
 * @param approvals - List of approvals for the step
 * @param quorumType - The quorum type (ALL or ANY)
 * @param minApprovals - Minimum approvals required (for ANY quorum)
 * @returns Whether the step is complete
 */
export function isStepComplete(
  approvals: Array<{ decision: ApprovalDecision }>,
  quorumType: "ALL" | "ANY",
  minApprovals?: number,
): boolean {
  const approvedCount = approvals.filter((a) => a.decision === "APPROVED").length;
  const rejectedCount = approvals.filter((a) => a.decision === "REJECTED").length;
  const reworkCount = approvals.filter((a) => a.decision === "REWORK").length;

  // If any rejection or rework, step is not approved
  if (rejectedCount > 0 || reworkCount > 0) {
    return true; // Step is complete but not approved
  }

  if (quorumType === "ALL") {
    return approvedCount === approvals.length;
  }
  // ANY
  const required = minApprovals ?? 1;
  return approvedCount >= required;
}

/**
 * Determine the step status based on approvals
 * @param approvals - List of approvals for the step
 * @param quorumType - The quorum type (ALL or ANY)
 * @param minApprovals - Minimum approvals required (for ANY quorum)
 * @returns The determined step status
 */
export function determineStepStatus(
  approvals: Array<{ decision: ApprovalDecision }>,
  quorumType: "ALL" | "ANY",
  minApprovals?: number,
): ChangeStepStatus {
  const rejectedCount = approvals.filter((a) => a.decision === "REJECTED").length;
  const reworkCount = approvals.filter((a) => a.decision === "REWORK").length;
  const approvedCount = approvals.filter((a) => a.decision === "APPROVED").length;

  if (rejectedCount > 0) {
    return "REJECTED";
  }
  if (reworkCount > 0) {
    return "REWORK";
  }

  if (quorumType === "ALL") {
    if (approvedCount === approvals.length) {
      return "APPROVED";
    }
  } else {
    const required = minApprovals ?? 1;
    if (approvedCount >= required) {
      return "APPROVED";
    }
  }

  return "PENDING";
}

/**
 * Build the approval update for a single approval record
 * @param options - Approve options
 * @returns Update data for the approval record
 */
export function buildApprovalUpdate(options: ApproveOptions): {
  decision: ApprovalDecision;
  decidedAt: Date;
  comment: string | undefined;
} {
  return {
    decision: "APPROVED",
    decidedAt: now(),
    comment: options.comment,
  };
}

/**
 * Build the rejection update for a single approval record
 * @param options - Reject options
 * @returns Update data for the approval record
 */
export function buildRejectionUpdate(options: RejectOptions): {
  decision: ApprovalDecision;
  decidedAt: Date;
  comment: string | undefined;
} {
  return {
    decision: "REJECTED",
    decidedAt: now(),
    comment: options.comment,
  };
}

/**
 * Build the rework update for a single approval record
 * @param options - Rework options
 * @returns Update data for the approval record
 */
export function buildReworkApprovalUpdate(options: RequestReworkOptions): {
  decision: ApprovalDecision;
  decidedAt: Date;
  comment: string | undefined;
} {
  return {
    decision: "REWORK",
    decidedAt: now(),
    comment: options.reason,
  };
}

/**
 * Build a rework event record
 * @param requestId - The change request ID
 * @param iteration - Current iteration
 * @param fromStepNo - The step number where rework was requested
 * @param options - Rework options
 * @returns Rework event record data
 */
export function buildReworkEvent(
  requestId: string,
  iteration: number,
  fromStepNo: number,
  options: RequestReworkOptions,
): {
  id: string;
  request: string;
  iteration: number;
  fromStepNo: number;
  requestedBy: string;
  requestedAt: Date;
  reason: string | undefined;
} {
  return {
    id: generateUUID(),
    request: requestId,
    iteration,
    fromStepNo,
    requestedBy: options.requestedBy,
    requestedAt: now(),
    reason: options.reason,
  };
}

/**
 * Build the step completion update
 * @param status - The new step status
 * @returns Update data for the step record
 */
export function buildStepCompletionUpdate(status: ChangeStepStatus): {
  status: ChangeStepStatus;
  finishedAt: Date;
} {
  return {
    status,
    finishedAt: now(),
  };
}

/**
 * Build the request status update
 * @param status - The new request status
 * @returns Update data for the request record
 */
export function buildRequestStatusUpdate(status: ChangeRequestStatus): {
  status: ChangeRequestStatus;
  finalizedAt: Date | undefined;
} {
  const isFinal = status === "APPROVED" || status === "REJECTED" || status === "CANCELED";
  return {
    status,
    finalizedAt: isFinal ? now() : undefined,
  };
}

/**
 * Build the activation update for a change request
 * @returns Update data for the request record
 */
export function buildActivationUpdate(): {
  activationStatus: ActivationStatus;
  activatedAt: Date;
} {
  return {
    activationStatus: "ACTIVATED",
    activatedAt: now(),
  };
}

/**
 * Build the record activation update (draft to active)
 * @returns Update data for the record
 */
export function buildRecordActivationUpdate(): {
  recordState: RecordState;
} {
  return {
    recordState: "ACTIVE",
  };
}

/**
 * Build the archive update for a record
 * @param archivedSeq - The archive sequence number
 * @returns Update data for the record
 */
export function buildArchiveUpdate(archivedSeq: number): {
  recordState: RecordState;
  archivedSeq: number;
  effectiveTo: Date;
} {
  return {
    recordState: "ARCHIVED",
    archivedSeq,
    effectiveTo: now(),
  };
}

/**
 * Check if a record is in draft state
 * @param record - The record to check
 * @param record.recordState
 * @returns Whether the record is a draft
 */
export function isDraft(record: { recordState: RecordState }): boolean {
  return record.recordState === "DRAFT";
}

/**
 * Check if a record is active
 * @param record - The record to check
 * @param record.recordState
 * @returns Whether the record is active
 */
export function isActive(record: { recordState: RecordState }): boolean {
  return record.recordState === "ACTIVE";
}

/**
 * Check if a record is archived
 * @param record - The record to check
 * @param record.recordState
 * @returns Whether the record is archived
 */
export function isArchived(record: { recordState: RecordState }): boolean {
  return record.recordState === "ARCHIVED";
}

/**
 * Check if a change request is pending approval
 * @param request - The change request to check
 * @param request.status
 * @returns Whether the request is pending
 */
export function isPendingApproval(request: { status: ChangeRequestStatus }): boolean {
  return request.status === "RUNNING" || request.status === "REWORK";
}

/**
 * Check if a change request is approved
 * @param request - The change request to check
 * @param request.status
 * @returns Whether the request is approved
 */
export function isApproved(request: { status: ChangeRequestStatus }): boolean {
  return request.status === "APPROVED";
}

/**
 * Check if a change request is rejected
 * @param request - The change request to check
 * @param request.status
 * @returns Whether the request is rejected
 */
export function isRejected(request: { status: ChangeRequestStatus }): boolean {
  return request.status === "REJECTED";
}

/**
 * Check if a change request is canceled
 * @param request - The change request to check
 * @param request.status
 * @returns Whether the request is canceled
 */
export function isCanceled(request: { status: ChangeRequestStatus }): boolean {
  return request.status === "CANCELED";
}

/**
 * Check if a change request is activated
 * @param request - The change request to check
 * @param request.activationStatus
 * @returns Whether the request is activated
 */
export function isActivated(request: { activationStatus: ActivationStatus }): boolean {
  return request.activationStatus === "ACTIVATED";
}

/**
 * Get the next step number
 * @param currentStepNo - Current step number
 * @param totalSteps - Total number of steps
 * @returns Next step number, or null if this is the last step
 */
export function getNextStepNo(currentStepNo: number, totalSteps: number): number | null {
  if (currentStepNo >= totalSteps) {
    return null;
  }
  return currentStepNo + 1;
}

/**
 * Build the advance step update for a request
 * @param nextStepNo - The next step number
 * @returns Update data for the request record
 */
export function buildAdvanceStepUpdate(nextStepNo: number): {
  currentStepNo: number;
} {
  return {
    currentStepNo: nextStepNo,
  };
}
