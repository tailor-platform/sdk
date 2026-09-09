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
 * Check whether the native keyring library can be loaded.
 * @returns true if the library is available; individual operations may still fail
 */
export async function isKeyringAvailable(): Promise<boolean> {
  return (await getEntryClass()) !== false;
}

/**
 * Load tokens from the OS keyring for a given account.
 * @param account - User identifier (e.g. email or client ID)
 * @returns Token data or undefined if not found
 */
export async function loadKeyringTokens(account: string): Promise<TokenData | undefined> {
  const Entry = await getEntryClass();
  if (!Entry) throw new Error("System keyring is not available.");

  const entry = new Entry(SERVICE_NAME, account);
  const raw = entry.getPassword();
  if (raw === null) return undefined;
  try {
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
  if (!Entry) throw new Error("System keyring is not available.");

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
