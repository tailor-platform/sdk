/**
 * IDP (Identity Provider) utilities.
 *
 * Thin typed wrapper around the platform-provided `tailor.idp` runtime API.
 * At runtime this delegates to `globalThis.tailor.idp`. Use `idpMock` from
 * `@tailor-platform/sdk/vitest` to mock these calls in unit tests.
 * @example
 * import { idp } from "@tailor-platform/sdk/runtime";
 *
 * const client = new idp.Client({ namespace: "my-namespace" });
 * const { users } = await client.users({ first: 10 });
 */

/** Configuration object for {@link Client}. */
export interface ClientConfig {
  namespace: string;
}

/** User record returned by IDP operations. */
export interface User {
  id: string;
  name: string;
  disabled: boolean;
  createdAt?: string;
}

/** Filter options for {@link Client.users}. */
export interface UserQuery {
  /** Filter by user IDs */
  ids?: string[];
  /** Filter by user names */
  names?: string[];
}

/** Pagination/filter options for {@link Client.users}. */
export interface ListUsersOptions {
  /** Maximum number of users to return */
  first?: number;
  /** Page token for pagination */
  after?: string;
  /** Query filter for users */
  query?: UserQuery;
}

/** Response shape for {@link Client.users}. */
export interface ListUsersResponse {
  users: User[];
  nextPageToken: string | null;
  totalCount: number;
}

/** Input for {@link Client.createUser}. */
export interface CreateUserInput {
  /** The user's name (typically email) */
  name: string;
  /** The user's password. If omitted, the user is created without a password (cannot log in with any password). */
  password?: string;
  /** Whether the user is disabled */
  disabled?: boolean;
}

/** Input for {@link Client.updateUser}. */
export interface UpdateUserInput {
  /** The user's ID */
  id: string;
  /** New name for the user */
  name?: string;
  /** New password for the user. Cannot be used with clearPassword. */
  password?: string;
  /** If true, remove the user's password. Cannot be used with password. */
  clearPassword?: boolean;
  /** New disabled status for the user */
  disabled?: boolean;
}

/** Input for {@link Client.sendPasswordResetEmail}. */
export interface SendPasswordResetEmailInput {
  /** The ID of the user */
  userId: string;
  /** The URI to redirect to after password reset */
  redirectUri: string;
  /** The sender display name. Defaults to 'Tailor Platform IdP'. */
  fromName?: string;
  /** The email subject line. Defaults to the localized default subject. */
  subject?: string;
}

/** Instance methods exposed by `tailor.idp.Client`. */
export interface IdpClientInstance {
  users(options?: ListUsersOptions): Promise<ListUsersResponse>;
  user(userId: string): Promise<User>;
  userByName(name: string): Promise<User>;
  createUser(input: CreateUserInput): Promise<User>;
  updateUser(input: UpdateUserInput): Promise<User>;
  deleteUser(userId: string): Promise<boolean>;
  sendPasswordResetEmail(input: SendPasswordResetEmailInput): Promise<boolean>;
}

/**
 * Constructor shape for `tailor.idp.Client`.
 * @internal
 */
export interface IdpClientConstructor {
  new (config: ClientConfig): IdpClientInstance;
}

/**
 * Platform API surface for `tailor.idp`. Describes the shape the platform
 * runtime injects on `globalThis.tailor.idp`.
 * @internal
 */
export interface TailorIdpAPI {
  Client: IdpClientConstructor;
}

/**
 * IDP Client for user management operations.
 *
 * Wraps the platform-provided `tailor.idp.Client` and exposes the same surface.
 */
export class Client {
  #impl: IdpClientInstance;

  constructor(config: ClientConfig) {
    this.#impl = new (globalThis as { tailor: { idp: TailorIdpAPI } }).tailor.idp.Client(config);
  }

  /**
   * List users in the namespace with optional filtering and pagination.
   * @param options - Pagination and filter options
   * @returns Page of users with `nextPageToken` and `totalCount`
   */
  users(options?: ListUsersOptions): Promise<ListUsersResponse> {
    return this.#impl.users(options);
  }

  /**
   * Get a user by ID.
   * @param userId - IDP user ID
   * @returns The matching user
   */
  user(userId: string): Promise<User> {
    return this.#impl.user(userId);
  }

  /**
   * Get a user by name.
   * @param name - IDP user name
   * @returns The matching user
   */
  userByName(name: string): Promise<User> {
    return this.#impl.userByName(name);
  }

  /**
   * Create a new user.
   * @param input - User attributes
   * @returns The newly created user
   */
  createUser(input: CreateUserInput): Promise<User> {
    return this.#impl.createUser(input);
  }

  /**
   * Update an existing user.
   * @param input - User ID plus attributes to update
   * @returns The updated user
   */
  updateUser(input: UpdateUserInput): Promise<User> {
    return this.#impl.updateUser(input);
  }

  /**
   * Delete a user by ID.
   * @param userId - IDP user ID
   * @returns `true` when the user was deleted
   */
  deleteUser(userId: string): Promise<boolean> {
    return this.#impl.deleteUser(userId);
  }

  /**
   * Send a password reset email to a user.
   * @param input - Target user ID and redirect URI
   * @returns `true` when the email was queued
   */
  sendPasswordResetEmail(input: SendPasswordResetEmailInput): Promise<boolean> {
    return this.#impl.sendPasswordResetEmail(input);
  }
}
