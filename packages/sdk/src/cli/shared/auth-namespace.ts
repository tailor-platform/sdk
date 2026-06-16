import type { AppConfig } from "@/configure/config/types";

type AuthNamespaceApplication = {
  authService?: { config: { name: string } };
  config?: Pick<AppConfig, "auth">;
};

/**
 * Resolve the auth namespace configured for an application.
 * @param application - Loaded application with local or external Auth config
 * @returns Auth namespace, or undefined when no Auth config is present
 */
export function getApplicationAuthNamespace(
  application: AuthNamespaceApplication,
): string | undefined {
  return application.authService?.config.name ?? application.config?.auth?.name;
}
