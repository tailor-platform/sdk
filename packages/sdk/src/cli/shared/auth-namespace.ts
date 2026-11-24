import { internalError } from "./errors";
import type { AppConfig } from "#/configure/config/types";

type AuthNamespaceApplication = {
  authServices: ReadonlyArray<{ config: { name: string } }>;
  config?: Pick<AppConfig, "auth"> | undefined;
};

type AuthServiceHolder<Service> = {
  authServices: ReadonlyArray<Service>;
};

/**
 * Get the Auth service of an application, which defines at most one.
 * @param application - Application whose Auth services to read
 * @returns The Auth service, or undefined when the application defines none
 */
export function soleAuthService<Service>(
  application: AuthServiceHolder<Service>,
): Service | undefined {
  const [authService, ...others] = application.authServices;
  if (others.length > 0) {
    throw internalError(
      `An application has one Auth service at most, but ${application.authServices.length} were defined`,
    );
  }
  return authService;
}

/**
 * Resolve the auth namespace configured for an application.
 * @param application - Loaded application with local or external Auth config
 * @returns Auth namespace, or undefined when no Auth config is present
 */
export function getApplicationAuthNamespace(
  application: AuthNamespaceApplication,
): string | undefined {
  return soleAuthService(application)?.config.name ?? application.config?.auth?.name;
}
