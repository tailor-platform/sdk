// Dummy generated file for e2e tests
import { type Kysely } from "kysely";

/**
 * Dummy getDB function for e2e tests
 * @param {string} namespace - TailorDB namespace
 * @returns {Kysely<any>} Kysely instance (throws error in test environment)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDB(namespace: string): Kysely<any> {
  throw new Error(`getDB is not implemented in test fixtures. Namespace: ${namespace}`);
}
