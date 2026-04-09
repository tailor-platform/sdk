import { logger } from "./logger";

const SERVICE_NAME = "tailor-platform-cli";

type TokenData = {
  accessToken: string;
  refreshToken?: string;
};

type EntryLike = {
  setPassword(password: string): void;
  getPassword(): string | null;
  deletePassword(): void;
};

type EntryConstructor = new (service: string, account: string) => EntryLike;

let entryClass: EntryConstructor | false | undefined;

async function getEntryClass(): Promise<EntryConstructor | false> {
  if (entryClass !== undefined) return entryClass;

  try {
    const mod = await import("@napi-rs/keyring");
    const probe = new mod.Entry(SERVICE_NAME, "__probe__");
    probe.setPassword("probe");
    probe.deletePassword();
    entryClass = mod.Entry;
  } catch {
    logger.warn(
      "System keyring is not available. Tokens will be stored in the config file. Set TAILOR_PLATFORM_TOKEN environment variable for CI environments.",
    );
    entryClass = false;
  }

  return entryClass;
}

/**
 * Check whether the OS keyring is available and functional.
 * @returns true if keyring is available
 */
export async function isKeyringAvailable(): Promise<boolean> {
  return (await getEntryClass()) !== false;
}

/**
 * Load tokens from the OS keyring for a given account.
 * @param account - User identifier (e.g. email or client ID)
 * @returns Token data or undefined if not found or keyring unavailable
 */
export async function loadKeyringTokens(account: string): Promise<TokenData | undefined> {
  const Entry = await getEntryClass();
  if (!Entry) return undefined;

  try {
    const entry = new Entry(SERVICE_NAME, account);
    const raw = entry.getPassword();
    if (raw === null) return undefined;
    return JSON.parse(raw) as TokenData;
  } catch {
    return undefined;
  }
}

/**
 * Save tokens to the OS keyring for a given account.
 * @param account - User identifier (e.g. email or client ID)
 * @param tokens - Token data to store
 */
export async function saveKeyringTokens(account: string, tokens: TokenData): Promise<void> {
  const Entry = await getEntryClass();
  if (!Entry) return;

  const entry = new Entry(SERVICE_NAME, account);
  entry.setPassword(JSON.stringify(tokens));
}

/**
 * Delete tokens from the OS keyring for a given account.
 * @param account - User identifier (e.g. email or client ID)
 */
export async function deleteKeyringTokens(account: string): Promise<void> {
  const Entry = await getEntryClass();
  if (!Entry) return;

  try {
    const entry = new Entry(SERVICE_NAME, account);
    entry.deletePassword();
  } catch {
    // Ignore "not found" errors
  }
}

/**
 * Reset the cached keyring state. Used for testing.
 */
export function resetKeyringState(): void {
  entryClass = undefined;
}

export type { TokenData };
