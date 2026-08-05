import { customer } from "../tailordb/customer";
import { invoice } from "../tailordb/invoice";
import { nestedProfile } from "../tailordb/nested";
import { productBundle } from "../tailordb/productBundle";
import { purchaseOrder } from "../tailordb/purchaseOrder";
import { salesOrder } from "../tailordb/salesOrder";
import { supplier } from "../tailordb/supplier";
import type { Namespace } from "../generated/tailordb";
// Pins `TailorDBColumns` against the table interfaces `kyselyTypePlugin` actually
// generates for this project. Both are derived from the same table definitions, so any
// drift between the two column mappings shows up here as a type error.
//
// This file only declares types; `tsc --noEmit` over the example is the assertion.
import type { TailorDBColumns } from "@tailor-platform/sdk/kysely";

type Emitted = Namespace["tailordb"];

type Flatten<T> = { [K in keyof T]: T[K] } & {};
type Same<Derived, Generated> = [Flatten<Derived>] extends [Flatten<Generated>]
  ? [Flatten<Generated>] extends [Flatten<Derived>]
    ? true
    : ["generated is not assignable to derived", Flatten<Derived>, Flatten<Generated>]
  : ["derived is not assignable to generated", Flatten<Derived>, Flatten<Generated>];
type Assert<T extends true> = T;

// Generated<Timestamp> on timestamps, plain scalars, nullable scalars.
export type CustomerParity = Assert<Same<TailorDBColumns<typeof customer>, Emitted["Customer"]>>;
// Serial<string> and Serial<number>, enum union or null.
export type InvoiceParity = Assert<Same<TailorDBColumns<typeof invoice>, Emitted["Invoice"]>>;
// Array of a nested object with no optional prop stays a plain object array.
export type ProductBundleParity = Assert<
  Same<TailorDBColumns<typeof productBundle>, Emitted["ProductBundle"]>
>;
// Nested object array alongside an enum union.
export type PurchaseOrderParity = Assert<
  Same<TailorDBColumns<typeof purchaseOrder>, Emitted["PurchaseOrder"]>
>;
// Timestamp | null, string[] | null, relation columns.
export type SalesOrderParity = Assert<
  Same<TailorDBColumns<typeof salesOrder>, Emitted["SalesOrder"]>
>;
// Enum union of string literals.
export type SupplierParity = Assert<Same<TailorDBColumns<typeof supplier>, Emitted["Supplier"]>>;

// Objects with optional props are wrapped in ObjectColumnType, and a datetime nested
// inside one resolves to Timestamp — the runtime hands back a Date there too.
export type NestedProfileParity = Assert<
  Same<TailorDBColumns<typeof nestedProfile>, Emitted["NestedProfile"]>
>;
