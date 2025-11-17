/**
 * Invoice status
 *
 * @property draft - Draft invoice
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

export const UserSettingLanguage = {
  "jp": "jp",
  "en": "en"
} as const;
export type UserSettingLanguage = (typeof UserSettingLanguage)[keyof typeof UserSettingLanguage];
