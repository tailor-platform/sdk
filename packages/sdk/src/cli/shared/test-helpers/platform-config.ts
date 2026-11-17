/** Substring of both tokens in {@link invalidYAMLPlatformConfig}. */
export const storedTokenMarker = "SECRET";

/**
 * A CLI config file that stores tokens and misindents its sixth line, so YAML parsing fails at
 * line 6, column 4, right below the token lines.
 */
export const invalidYAMLPlatformConfig = [
  "version: 1",
  "users:",
  "  alice:",
  `    access_token: eyJ${storedTokenMarker}ACCESS`,
  `    refresh_token: ${storedTokenMarker}REFRESH`,
  '   token_expires_at: "2099-01-01T00:00:00.000Z"',
  "current_user: alice",
  "",
].join("\n");
