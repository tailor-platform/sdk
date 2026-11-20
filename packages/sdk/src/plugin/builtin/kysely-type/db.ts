import { createGetDB as createNamespaceMapGetDB } from "#/kysely/index";

type MaybeProcessGlobal = { process?: { env: Record<string, string | undefined> } };

/**
 * **Beta:** Get a Kysely instance for a TailorDB namespace. With TypeScript 7.1 or later and the SDK enabled
 * as a content mapper for `.tailor` files, its tables and columns are typed from your TailorDB
 * definitions. Date, datetime, and time columns follow the `temporal` option of `kyselyTypePlugin`.
 */
export const getDB = createNamespaceMapGetDB({
  temporal:
    (globalThis as MaybeProcessGlobal).process?.env.__TAILOR_PLATFORM_BUNDLE_KYSELY_TEMPORAL ===
    "true",
});

/**
 * **Beta:** Get a `getDB` that accepts only the given TailorDB namespaces, such as
 * `createGetDB<"customer-db" | "order-db">()`, typed by the content mapper. This is not
 * `createGetDB` of `@tailor-platform/sdk/kysely`, whose type argument maps namespaces to their
 * tables: here it is a union of namespace names, and the returned `getDB` is the one this module
 * exports.
 * @returns `getDB`
 */
export function createGetDB(): typeof getDB {
  return getDB;
}
