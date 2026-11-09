import { logger, styles } from "#/cli/shared/logger";
import { permissionInputFields } from "#/parser/service/resolver/permission-operands";
import type { Resolver } from "#/types/resolver.generated";

const ACTING_USER_ID_INPUT_PATTERNS = [
  /^(actor|caller|executor|approver|performer|operator)_?(user_?)?id$/i,
  /^(created|updated|deleted|approved|rejected|cancell?ed|submitted|requested|reviewed|executed|performed)_?by(_?user)?(_?id)?$/i,
];

type ResolverFields = {
  resolver: string;
  fields: string[];
};

type WarnResolverInputsParams = {
  namespace: string;
  /** Resolvers whose source the user owns; plugin-generated ones are left out. */
  resolvers: Resolver[];
};

function actingUserIdInputs(resolver: Resolver): string[] {
  if (resolver.operation !== "mutation") {
    return [];
  }
  const compared = permissionInputFields(resolver.permission);
  return Object.keys(resolver.input ?? {}).filter(
    (name) =>
      !compared.has(name) && ACTING_USER_ID_INPUT_PATTERNS.some((pattern) => pattern.test(name)),
  );
}

/**
 * Warn once for a namespace, then list each affected resolver and its fields,
 * sorted because resolvers load concurrently.
 * @param heading - The warning line
 * @param entries - Affected resolvers and their fields
 */
function warnResolverFields(heading: string, entries: ResolverFields[]): void {
  if (entries.length === 0) {
    return;
  }
  logger.warn(heading);
  for (const { resolver, fields } of entries.toSorted((a, b) =>
    a.resolver < b.resolver ? -1 : 1,
  )) {
    logger.log(`  ${resolver}: ${fields.join(", ")}`);
  }
}

/**
 * Warn about mutations that take the acting user's ID as input, which lets a
 * caller act as another user by sending that user's ID. An input the
 * resolver's `permission` compares with the caller is not reported.
 * @param params - The namespace and its user-owned resolvers
 */
export function warnActingUserIdInputs(params: WarnResolverInputsParams): void {
  const { namespace, resolvers } = params;
  warnResolverFields(
    `Resolver namespace ${styles.highlight(`"${namespace}"`)} has mutations whose input looks ` +
      "like the acting user's ID, so a caller can act as another user by sending their ID. " +
      "Take the acting user from `caller` in `body`, compare the input with the caller in " +
      "`permission`, or rename an input that names another user on purpose:",
    resolvers.flatMap((resolver) => {
      const fields = actingUserIdInputs(resolver);
      return fields.length > 0 ? [{ resolver: resolver.name, fields }] : [];
    }),
  );
}
