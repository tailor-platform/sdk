/**
 * Invoice status
 *
 * @property draft - Draft invoice
 * @property sent
 * @property paid - Paid invoice
 * @property cancelled - Cancelled invoice
 */
export const InvoiceStatus = {
  "draft": "draft",
  "sent": "sent",
  "paid": "paid",
  "cancelled": "cancelled"
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const PurchaseOrderAttachedFilesType = {
  "text": "text",
  "image": "image"
} as const;
export type PurchaseOrderAttachedFilesType = (typeof PurchaseOrderAttachedFilesType)[keyof typeof PurchaseOrderAttachedFilesType];

export const SupplierState = {
  "Alabama": "Alabama",
  "Alaska": "Alaska"
} as const;
export type SupplierState = (typeof SupplierState)[keyof typeof SupplierState];

export const UserRole = {
  "MANAGER": "MANAGER",
  "STAFF": "STAFF"
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserChangeRequestStatus = {
  "RUNNING": "RUNNING",
  "REWORK": "REWORK",
  "APPROVED": "APPROVED",
  "REJECTED": "REJECTED",
  "CANCELED": "CANCELED"
} as const;
export type UserChangeRequestStatus = (typeof UserChangeRequestStatus)[keyof typeof UserChangeRequestStatus];

export const UserChangeRequestActivationStatus = {
  "PENDING": "PENDING",
  "ACTIVATED": "ACTIVATED"
} as const;
export type UserChangeRequestActivationStatus = (typeof UserChangeRequestActivationStatus)[keyof typeof UserChangeRequestActivationStatus];

export const UserChangeStepQuorumType = {
  "ALL": "ALL",
  "ANY": "ANY"
} as const;
export type UserChangeStepQuorumType = (typeof UserChangeStepQuorumType)[keyof typeof UserChangeStepQuorumType];

export const UserChangeStepStatus = {
  "PENDING": "PENDING",
  "APPROVED": "APPROVED",
  "REWORK": "REWORK",
  "REJECTED": "REJECTED",
  "SKIPPED": "SKIPPED"
} as const;
export type UserChangeStepStatus = (typeof UserChangeStepStatus)[keyof typeof UserChangeStepStatus];

export const UserChangeApprovalDecision = {
  "PENDING": "PENDING",
  "APPROVED": "APPROVED",
  "REWORK": "REWORK",
  "REJECTED": "REJECTED"
} as const;
export type UserChangeApprovalDecision = (typeof UserChangeApprovalDecision)[keyof typeof UserChangeApprovalDecision];

export const UserChangeApprovalResolvedByRuleType = {
  "USER": "USER",
  "GROUP": "GROUP",
  "ROLE": "ROLE",
  "ORG_MANAGER": "ORG_MANAGER"
} as const;
export type UserChangeApprovalResolvedByRuleType = (typeof UserChangeApprovalResolvedByRuleType)[keyof typeof UserChangeApprovalResolvedByRuleType];

export const UserSettingLanguage = {
  "jp": "jp",
  "en": "en"
} as const;
export type UserSettingLanguage = (typeof UserSettingLanguage)[keyof typeof UserSettingLanguage];

export const EventName = {
  "CLICK": "CLICK",
  "VIEW": "VIEW",
  "PURCHASE": "PURCHASE"
} as const;
export type EventName = (typeof EventName)[keyof typeof EventName];
