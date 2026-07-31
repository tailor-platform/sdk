/**
 * Top-level builtin command names. A plugin named the same as one of these is
 * shadowed by the builtin and can never be dispatched.
 *
 * This list is the single source of truth used by `plugin list` to flag
 * shadowed plugins without importing the (cyclic) command tree. It is kept in
 * sync with `main-command.ts` by a drift test in `options.test.ts`.
 */
export const BUILTIN_COMMAND_NAMES = [
  "api",
  "auth",
  "authconnection",
  "crashreport",
  "deploy",
  "executor",
  "function",
  "generate",
  "init",
  "login",
  "logout",
  "machineuser",
  "oauth2client",
  "open",
  "organization",
  "plugin",
  "profile",
  "query",
  "remove",
  "secret",
  "setup",
  "show",
  "skills",
  "staticwebsite",
  "tailordb",
  "upgrade",
  "user",
  "workflow",
  "workspace",
] as const;
