/**
 * Symbol brands for type identification.
 * These symbols are used to reliably identify SDK objects
 * without relying on instanceof checks or property shape detection.
 */

/** Brand symbol for TailorField instances */
export const TAILOR_FIELD_BRAND = Symbol.for("@tailor-platform/sdk/TailorField");

/** Brand symbol for TailorDBField instances */
export const TAILOR_DB_FIELD_BRAND = Symbol.for("@tailor-platform/sdk/TailorDBField");

/** Brand symbol for TailorDBType instances */
export const TAILOR_DB_TYPE_BRAND = Symbol.for("@tailor-platform/sdk/TailorDBType");
