const PASSWORD_ENV = "SEED_USER_PASSWORD";

type Env = Record<string, string | undefined>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function passwordFor(name: unknown, raw: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (!isRecord(parsed)) return raw;
  const password = typeof name === "string" ? parsed[name] : undefined;
  return typeof password === "string" ? password : undefined;
}

/**
 * Fill in the `password` of an IdP `_User` seed row from the `SEED_USER_PASSWORD`
 * environment variable. A row that already has a `password` keeps it.
 *
 * A plain string applies to every user. A JSON object maps each user `name` to its
 * password, and a user missing from the object is left without one.
 * @param row - A `_User` seed row
 * @param env - Environment to read from. Defaults to `process.env`.
 * @returns The row with `password` filled in when the environment supplies one
 */
export function fillIdpUserPassword(row: unknown, env: Env = process.env): unknown {
  if (!isRecord(row) || (row.password !== undefined && row.password !== null)) return row;
  const raw = env[PASSWORD_ENV];
  if (!raw) return row;
  const password = passwordFor(row.name, raw);
  return password === undefined ? row : { ...row, password };
}
