/**
 * @property PENDING - Awaiting confirmation
 * @property CONFIRMED - Order confirmed
 * @property SHIPPED - In transit
 * @property DELIVERED - Successfully delivered
 * @property CANCELLED - Order cancelled
 */
export const OrderStatus = {
  "PENDING": "PENDING",
  "CONFIRMED": "CONFIRMED",
  "SHIPPED": "SHIPPED",
  "DELIVERED": "DELIVERED",
  "CANCELLED": "CANCELLED"
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/**
 * @property DRAFT - Not yet published
 * @property ACTIVE - Available for purchase
 * @property DISCONTINUED - No longer sold
 */
export const ProductStatus = {
  "DRAFT": "DRAFT",
  "ACTIVE": "ACTIVE",
  "DISCONTINUED": "DISCONTINUED"
} as const;
export type ProductStatus = (typeof ProductStatus)[keyof typeof ProductStatus];

/**
 * @property ADMIN - Administrator with full access
 * @property MEMBER - Regular team member
 * @property VIEWER - Read-only access
 */
export const UserRole = {
  "ADMIN": "ADMIN",
  "MEMBER": "MEMBER",
  "VIEWER": "VIEWER"
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
