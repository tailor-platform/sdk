// Interface for module augmentation
// Users can extend via: declare module "@tailor-platform/sdk" { interface SecretVaultNameRegistry { "vault-name": "secret-name"; } }
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SecretVaultNameRegistry {}

/**
 * Secret Manager vault name declared via `defineSecretManager()`.
 *
 * When `tailor.d.ts` is generated (via `tailor deploy`/`generate`), this is narrowed
 * to the union of vault names declared via `defineSecretManager()` (autocompleted),
 * while still accepting any other string. Unlike the other `*NameRegistry` types,
 * declaring some vaults does not reject the rest: Secret Manager vaults can also be
 * managed imperatively via the CLI, entirely outside `defineSecretManager()`, so a
 * vault name absent from the registry is not necessarily a mistake.
 */
export type SecretVaultName = keyof SecretVaultNameRegistry extends never
  ? string
  : keyof SecretVaultNameRegistry | (string & {});

/**
 * Secret name narrowed to the vault `V`, looked up in registry `R`.
 *
 * Generic over the registry so type-level tests can exercise this narrowing against
 * a local, disposable registry shape instead of `declare module`-augmenting the real
 * `SecretVaultNameRegistry` — that augmentation is ambient and leaks into every other
 * file type-checked in the same program, not just the test file that declares it.
 */
export type SecretNameForRegistry<V, R> = V extends keyof R ? R[V] & string : string;

/**
 * Secret name narrowed to the vault `V`.
 *
 * Inside a vault declared via `defineSecretManager()`, only that vault's declared
 * secret names are accepted — the config is the source of truth for that vault, so
 * an unlisted name is a typo. For any other vault (for example one managed only via
 * the CLI), falls back to `string`.
 */
export type SecretNameFor<V> = SecretNameForRegistry<V, SecretVaultNameRegistry>;
