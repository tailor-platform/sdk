import { customer } from "../tailordb/customer";
import { invoice } from "../tailordb/invoice";
import { nestedProfile } from "../tailordb/nested";
import { productBundle } from "../tailordb/productBundle";
import { purchaseOrder } from "../tailordb/purchaseOrder";
import { salesOrder } from "../tailordb/salesOrder";
import { supplier } from "../tailordb/supplier";
import type { Namespace } from "../generated/tailordb";
import type { TailorAnyDBType } from "@tailor-platform/sdk";
// Pins the input types derived from a table against the interfaces `kyselyTypePlugin`
// actually generates for this project. Both come from the same table definitions, so any
// drift between the two column mappings shows up here as a type error.
//
// Comparing all three projections covers the column map itself: between them they read
// every slot of a ColumnType, so two maps that agree on all three agree everywhere.
//
// This file only declares types; `tsc --noEmit` over the example is the assertion.
import type {
  Insertable,
  Selectable,
  TailorDBInsertable,
  TailorDBSelectable,
  TailorDBUpdateable,
  Updateable,
} from "@tailor-platform/sdk/kysely";

type Emitted = Namespace["tailordb"];

type Flatten<T> = { [K in keyof T]: T[K] } & {};
type Equal<Derived, Generated> = [Flatten<Derived>] extends [Flatten<Generated>]
  ? [Flatten<Generated>] extends [Flatten<Derived>]
    ? true
    : ["generated is not assignable to derived", Flatten<Derived>, Flatten<Generated>]
  : ["derived is not assignable to generated", Flatten<Derived>, Flatten<Generated>];

type Same<Table extends TailorAnyDBType, Name extends keyof Emitted> =
  Equal<TailorDBInsertable<Table>, Insertable<Emitted[Name]>> extends true
    ? Equal<TailorDBSelectable<Table>, Selectable<Emitted[Name]>> extends true
      ? Equal<TailorDBUpdateable<Table>, Updateable<Emitted[Name]>>
      : ["selectable differs", Equal<TailorDBSelectable<Table>, Selectable<Emitted[Name]>>]
    : ["insertable differs", Equal<TailorDBInsertable<Table>, Insertable<Emitted[Name]>>];

type Assert<T extends true> = T;

// Generated<Timestamp> on timestamps, plain scalars, nullable scalars.
export type CustomerParity = Assert<Same<typeof customer, "Customer">>;
// Serial<string> and Serial<number>, enum union or null.
export type InvoiceParity = Assert<Same<typeof invoice, "Invoice">>;
// Array of a nested object with no optional prop stays a plain object array.
export type ProductBundleParity = Assert<Same<typeof productBundle, "ProductBundle">>;
// Nested object array alongside an enum union.
export type PurchaseOrderParity = Assert<Same<typeof purchaseOrder, "PurchaseOrder">>;
// Timestamp | null, string[] | null, relation columns.
export type SalesOrderParity = Assert<Same<typeof salesOrder, "SalesOrder">>;
// Enum union of string literals.
export type SupplierParity = Assert<Same<typeof supplier, "Supplier">>;
// Objects wrapped in ObjectColumnType, including a datetime nested inside one.
export type NestedProfileParity = Assert<Same<typeof nestedProfile, "NestedProfile">>;
