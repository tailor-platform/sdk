import { createGetDB } from "#/kysely/index";

type MaybeProcessGlobal = { process?: { env: Record<string, string | undefined> } };

/**
 * **Beta:** Get a Kysely instance for a TailorDB namespace. With TypeScript 7.1 or later and the SDK enabled
 * as a content mapper for `.tailor` files, its tables and columns are typed from your TailorDB
 * definitions. Date, datetime, and time columns follow the `temporal` option of `kyselyTypePlugin`.
 */
export const getDB = createGetDB({
  temporal:
    (globalThis as MaybeProcessGlobal).process?.env.__TAILOR_PLATFORM_BUNDLE_KYSELY_TEMPORAL ===
    "true",
});

/**
 * **Beta:** Get a `getDB` that accepts only the given TailorDB namespaces, such as
 * `createScopedGetDB<"customer-db" | "order-db">()`, typed by the content mapper. The returned
 * `getDB` is the one this module exports.
 * @returns `getDB`
 */
export function createScopedGetDB(): typeof getDB {
  return getDB;
}
