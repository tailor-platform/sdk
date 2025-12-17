export * from "./schema";
export type * from "./types";

/**
 * Converts token lifetime seconds to Duration-like objects for protobuf
 */
export function convertTokenLifetimesToDuration(
  accessTokenLifetimeSeconds?: number,
  refreshTokenLifetimeSeconds?: number,
): {
  accessTokenLifetime?: { seconds: bigint; nanos: number };
  refreshTokenLifetime?: { seconds: bigint; nanos: number };
} {
  return {
    accessTokenLifetime: accessTokenLifetimeSeconds
      ? { seconds: BigInt(accessTokenLifetimeSeconds), nanos: 0 }
      : undefined,
    refreshTokenLifetime: refreshTokenLifetimeSeconds
      ? { seconds: BigInt(refreshTokenLifetimeSeconds), nanos: 0 }
      : undefined,
  };
}
