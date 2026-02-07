/**
 * Changeset plugin module.
 *
 * Provides the changeset plugin and utility functions for working with
 * changeset-managed records (approval workflows, version control, etc.)
 * @example
 * ```typescript
 * import {
 *   buildDraftFields,
 *   buildChangeRequest,
 *   buildChangeSteps,
 *   buildChangeApprovals,
 *   isApproved,
 *   isPendingApproval,
 * } from "@tailor-platform/sdk/changeset-plugin";
 * ```
 */

// Re-export plugin
export { changesetPlugin, getGeneratedType } from "./plugin";
export type { GeneratedTypeKind } from "./plugin";

// Re-export types
export type {
  RecordState,
  ChangeRequestStatus,
  ChangeStepStatus,
  ActivationStatus,
  ApprovalDecision,
  QuorumType,
  ResolvedByRuleType,
  ChangesetRecordFields,
  ChangeRequest,
  ChangeStep,
  ChangeApproval,
  ChangeReworkEvent,
  CreateDraftOptions,
  SubmitForApprovalOptions,
  ApprovalStepConfig,
  ApproverConfig,
  ApproveOptions,
  RejectOptions,
  RequestReworkOptions,
  ActivateOptions,
  ArchiveOptions,
  ApprovalResult,
} from "./types";

// Re-export operations
export {
  // Draft operations
  buildDraftFields,
  // Change request operations
  buildChangeRequest,
  buildChangeSteps,
  buildChangeApprovals,
  // Approval operations
  buildApprovalUpdate,
  buildRejectionUpdate,
  buildReworkApprovalUpdate,
  buildReworkEvent,
  // Step operations
  isStepComplete,
  determineStepStatus,
  buildStepCompletionUpdate,
  getNextStepNo,
  buildAdvanceStepUpdate,
  // Request operations
  buildRequestStatusUpdate,
  buildActivationUpdate,
  // Record operations
  buildRecordActivationUpdate,
  buildArchiveUpdate,
  // Status checks
  isDraft,
  isActive,
  isArchived,
  isPendingApproval,
  isApproved,
  isRejected,
  isCanceled,
  isActivated,
} from "./operations";
