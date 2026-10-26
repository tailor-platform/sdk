import { createHash } from "node:crypto";

const MAX_NAME_LENGTH = 63;
const HASH_LENGTH = 8;

/**
 * Name of the temporary workflow resources that seed one namespace, `tailor-seed-<kind>--<namespace>`.
 * The platform limits these names to 63 characters, so a namespace that does not fit is cut short and
 * followed by a hash of the whole namespace, which keeps two long namespaces with the same start apart.
 * @param kind - What the script seeds, e.g. `tailordb` or `idp-seed`
 * @param namespace - Namespace the script seeds
 * @returns Resource name of at most 63 characters
 */
export function seedWorkflowName(kind: string, namespace: string): string {
  const prefix = `tailor-seed-${kind}--`;
  if (prefix.length + namespace.length <= MAX_NAME_LENGTH) return `${prefix}${namespace}`;

  const hash = createHash("sha256").update(namespace).digest("hex").slice(0, HASH_LENGTH);
  const room = MAX_NAME_LENGTH - prefix.length - HASH_LENGTH - 1;
  return `${prefix}${namespace.slice(0, room)}-${hash}`;
}
