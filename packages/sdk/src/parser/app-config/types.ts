import type { AppConfig } from "#/configure/config/types";

type WithoutLegacyReference<T> = Exclude<T, { external: true }>;

/** Application config after parsing service references, preserving owned SDK builders. */
export type NormalizedAppConfig = Omit<AppConfig, "db" | "resolver" | "auth" | "idp"> & {
  db?: Record<string, WithoutLegacyReference<NonNullable<AppConfig["db"]>[string]>>;
  resolver?: Record<string, WithoutLegacyReference<NonNullable<AppConfig["resolver"]>[string]>>;
  auth?: WithoutLegacyReference<AppConfig["auth"]>;
  idp?: WithoutLegacyReference<NonNullable<AppConfig["idp"]>[number]>[];
};
