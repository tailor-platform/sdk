/**
 * The `allowedEmailDomains` entry that permits every email domain. It has to be
 * the only entry in the list.
 */
export const ALL_EMAIL_DOMAINS = "*";

/**
 * A single `allowedEmailDomains` entry: a hostname, or {@link ALL_EMAIL_DOMAINS}.
 *
 * The platform validates entries with protovalidate's `isHostname()`, which is
 * looser than this pattern in the corners (trailing dot, IDN). Surrounding
 * whitespace is deliberately rejected even though the platform trims it before
 * storing, because a padded entry would otherwise be echoed back normalized and
 * show up as a permanent diff in every subsequent plan.
 */
export const allowedEmailDomainPattern =
  /^(\*|[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/;

/**
 * Whether the list carries the all-domains entry.
 *
 * Trimming mirrors the platform, which trims before comparing, so a padded
 * entry cannot slip past the exclusivity check here either.
 * @param domains - Raw `allowedEmailDomains` entries
 * @returns Whether any entry is the all-domains entry
 */
export function containsAllEmailDomains(domains: readonly string[]): boolean {
  return domains.some((domain) => domain.trim() === ALL_EMAIL_DOMAINS);
}

type EmailDomainPolicy = {
  useNonEmailIdentifier?: boolean | undefined;
  allowedEmailDomains?: readonly string[] | undefined;
};

/**
 * Whether a policy leaves the accepted email domains implicit.
 *
 * An empty or omitted `allowedEmailDomains` currently means "every domain", but
 * the platform is moving that meaning behind an explicit `["*"]`, so the CLI
 * warns about such policies to nudge authors into declaring their intent while
 * both forms still work. Namespaces with `useNonEmailIdentifier` never reach
 * domain validation and cannot set the field at all, so they are not affected.
 * @param policy - The IdP user auth policy from user config
 * @returns Whether the CLI should warn about an implicit all-domains state
 */
export function hasImplicitAllEmailDomains(policy: EmailDomainPolicy | undefined): boolean {
  if (policy?.useNonEmailIdentifier === true) {
    return false;
  }
  return !policy?.allowedEmailDomains || policy.allowedEmailDomains.length === 0;
}
