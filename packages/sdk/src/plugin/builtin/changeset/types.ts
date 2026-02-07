/**
 * Type definitions for changeset plugin operations.
 */

/**
 * Record state for changeset management
 */
export type RecordState = "DRAFT" | "ACTIVE" | "ARCHIVED";

/**
 * Change request status
 */
export type ChangeRequestStatus = "RUNNING" | "REWORK" | "APPROVED" | "REJECTED" | "CANCELED";

/**
 * Change step status
 */
export type ChangeStepStatus = "PENDING" | "APPROVED" | "REWORK" | "REJECTED" | "SKIPPED";

/**
 * Activation status for change request
 */
export type ActivationStatus = "PENDING" | "ACTIVATED";

/**
 * Approval decision
 */
export type ApprovalDecision = "PENDING" | "APPROVED" | "REWORK" | "REJECTED";

/**
 * Quorum type for approval step
 */
export type QuorumType = "ALL" | "ANY";

/**
 * Rule type for approval resolution
 */
export type ResolvedByRuleType = "USER" | "GROUP" | "ROLE" | "ORG_MANAGER";

/**
 * Base record fields added by changeset plugin
 */
export interface ChangesetRecordFields {
  recordId: string;
  recordState: RecordState;
  archivedSeq: number;
  effectiveFrom: Date;
  effectiveTo?: Date;
  requestedBy: string;
  requestedAt: Date;
  currentApprover?: string;
  approvers: string[];
}

/**
 * Change request record
 */
export interface ChangeRequest {
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
  finalizedAt?: Date;
  effectiveFrom: Date;
  activationStatus: ActivationStatus;
  activatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Change step record
 */
export interface ChangeStep {
  id: string;
  request: string;
  iteration: number;
  stepNo: number;
  stepName: string;
  quorumType: QuorumType;
  minApprovals?: number;
  status: ChangeStepStatus;
  startedAt: Date;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Change approval record
 */
export interface ChangeApproval {
  id: string;
  request: string;
  iteration: number;
  stepNo: number;
  approver: string;
  decision: ApprovalDecision;
  decidedAt?: Date;
  comment?: string;
  resolvedByRuleType: ResolvedByRuleType;
  resolvedByRuleValue?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Change rework event record
 */
export interface ChangeReworkEvent {
  id: string;
  request: string;
  iteration: number;
  fromStepNo: number;
  requestedBy: string;
  requestedAt: Date;
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Options for creating a draft record
 */
export interface CreateDraftOptions<T> {
  data: Omit<T, keyof ChangesetRecordFields | "id" | "createdAt" | "updatedAt">;
  requestedBy: string;
  effectiveFrom?: Date;
}

/**
 * Options for submitting a draft for approval
 */
export interface SubmitForApprovalOptions {
  draftId: string;
  recordId: string;
  templateKey: string;
  templateVersion: number;
  requestedBy: string;
  effectiveFrom: Date;
  steps: ApprovalStepConfig[];
}

/**
 * Configuration for an approval step
 */
export interface ApprovalStepConfig {
  stepNo: number;
  stepName: string;
  quorumType: QuorumType;
  minApprovals?: number;
  approvers: ApproverConfig[];
}

/**
 * Configuration for an approver
 */
export interface ApproverConfig {
  approver: string;
  resolvedByRuleType: ResolvedByRuleType;
  resolvedByRuleValue?: string;
}

/**
 * Options for approving a change request
 */
export interface ApproveOptions {
  requestId: string;
  approverId: string;
  comment?: string;
}

/**
 * Options for rejecting a change request
 */
export interface RejectOptions {
  requestId: string;
  approverId: string;
  comment?: string;
}

/**
 * Options for requesting rework
 */
export interface RequestReworkOptions {
  requestId: string;
  requestedBy: string;
  reason?: string;
}

/**
 * Options for activating an approved record
 */
export interface ActivateOptions {
  requestId: string;
}

/**
 * Options for archiving a record
 */
export interface ArchiveOptions {
  recordId: string;
  archivedSeq: number;
}

/**
 * Result of an approval operation
 */
export interface ApprovalResult {
  success: boolean;
  stepCompleted: boolean;
  requestCompleted: boolean;
  newStatus?: ChangeStepStatus;
  requestStatus?: ChangeRequestStatus;
}
