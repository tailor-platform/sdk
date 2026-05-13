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

import {
  runtime,
  type IdpClientConfig,
  type IdpClientInstance,
  type IdpCreateUserInput,
  type IdpListUsersOptions,
  type IdpListUsersResponse,
  type IdpSendPasswordResetEmailInput,
  type IdpUpdateUserInput,
  type IdpUser,
  type IdpUserQuery,
} from "./_runtime";

/** Configuration object for {@link Client}. */
export type ClientConfig = IdpClientConfig;

/** User record returned by IDP operations. */
export type User = IdpUser;

/** Filter options for {@link Client.users}. */
export type UserQuery = IdpUserQuery;

/** Pagination/filter options for {@link Client.users}. */
export type ListUsersOptions = IdpListUsersOptions;

/** Response shape for {@link Client.users}. */
export type ListUsersResponse = IdpListUsersResponse;

/** Input for {@link Client.createUser}. */
export type CreateUserInput = IdpCreateUserInput;

/** Input for {@link Client.updateUser}. */
export type UpdateUserInput = IdpUpdateUserInput;

/** Input for {@link Client.sendPasswordResetEmail}. */
export type SendPasswordResetEmailInput = IdpSendPasswordResetEmailInput;

/**
 * IDP Client for user management operations.
 *
 * Wraps the platform-provided `tailor.idp.Client` and exposes the same surface.
 */
export class Client {
  #impl: IdpClientInstance;

  constructor(config: ClientConfig) {
    this.#impl = new runtime.tailor.idp.Client(config);
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
