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

/**
 * Current state of the record
 */
export const PurchaseOrderRecordState = {
  "DRAFT": "DRAFT",
  "ACTIVE": "ACTIVE",
  "ARCHIVED": "ARCHIVED"
} as const;
export type PurchaseOrderRecordState = (typeof PurchaseOrderRecordState)[keyof typeof PurchaseOrderRecordState];

export const PurchaseOrderChangeRequestStatus = {
  "RUNNING": "RUNNING",
  "REWORK": "REWORK",
  "APPROVED": "APPROVED",
  "REJECTED": "REJECTED",
  "CANCELED": "CANCELED"
} as const;
export type PurchaseOrderChangeRequestStatus = (typeof PurchaseOrderChangeRequestStatus)[keyof typeof PurchaseOrderChangeRequestStatus];

export const PurchaseOrderChangeRequestActivationStatus = {
  "PENDING": "PENDING",
  "ACTIVATED": "ACTIVATED"
} as const;
export type PurchaseOrderChangeRequestActivationStatus = (typeof PurchaseOrderChangeRequestActivationStatus)[keyof typeof PurchaseOrderChangeRequestActivationStatus];

export const PurchaseOrderChangeStepQuorumType = {
  "ALL": "ALL",
  "ANY": "ANY"
} as const;
export type PurchaseOrderChangeStepQuorumType = (typeof PurchaseOrderChangeStepQuorumType)[keyof typeof PurchaseOrderChangeStepQuorumType];

export const PurchaseOrderChangeStepStatus = {
  "PENDING": "PENDING",
  "APPROVED": "APPROVED",
  "REWORK": "REWORK",
  "REJECTED": "REJECTED",
  "SKIPPED": "SKIPPED"
} as const;
export type PurchaseOrderChangeStepStatus = (typeof PurchaseOrderChangeStepStatus)[keyof typeof PurchaseOrderChangeStepStatus];

export const PurchaseOrderChangeApprovalDecision = {
  "PENDING": "PENDING",
  "APPROVED": "APPROVED",
  "REWORK": "REWORK",
  "REJECTED": "REJECTED"
} as const;
export type PurchaseOrderChangeApprovalDecision = (typeof PurchaseOrderChangeApprovalDecision)[keyof typeof PurchaseOrderChangeApprovalDecision];

export const PurchaseOrderChangeApprovalResolvedByRuleType = {
  "USER": "USER",
  "GROUP": "GROUP",
  "ROLE": "ROLE",
  "ORG_MANAGER": "ORG_MANAGER"
} as const;
export type PurchaseOrderChangeApprovalResolvedByRuleType = (typeof PurchaseOrderChangeApprovalResolvedByRuleType)[keyof typeof PurchaseOrderChangeApprovalResolvedByRuleType];

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
