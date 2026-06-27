export const CustomerLoyaltyTier = {
  "standard": "standard",
  "gold": "gold",
  "platinum": "platinum"
} as const;
export type CustomerLoyaltyTier = (typeof CustomerLoyaltyTier)[keyof typeof CustomerLoyaltyTier];

export const CustomerNoteVisibility = {
  "internal": "internal",
  "shared": "shared"
} as const;
export type CustomerNoteVisibility = (typeof CustomerNoteVisibility)[keyof typeof CustomerNoteVisibility];

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

export const EventName = {
  "CLICK": "CLICK",
  "VIEW": "VIEW",
  "PURCHASE": "PURCHASE"
} as const;
export type EventName = (typeof EventName)[keyof typeof EventName];
