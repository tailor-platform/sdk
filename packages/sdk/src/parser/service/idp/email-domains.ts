/**
 * The `allowedEmailDomains` entry that permits every email domain. It has to be
 * the only entry in the list.
 */
export const ALL_EMAIL_DOMAINS = "*";

/**
 * A single `allowedEmailDomains` entry: a hostname, or {@link ALL_EMAIL_DOMAINS}.
 *
 * Two forms the platform accepts are rejected here, because each stores an entry
 * that can never match: surrounding whitespace, which the platform trims and then
 * echoes back normalized as a permanent diff in every later plan, and a trailing
 * dot, which a domain taken from an email address never carries. Elsewhere this
 * is looser than the platform's own check, so nothing else it accepts is rejected
 * here.
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
