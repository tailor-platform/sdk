import { describe, it, expect } from "vitest";
import { convertTokenLifetimesToDuration } from "./auth";

describe("convertTokenLifetimesToDuration", () => {
  it("converts access token lifetime seconds to Duration", () => {
    const result = convertTokenLifetimesToDuration(3600, undefined);

    expect(result.accessTokenLifetime).toEqual({
      seconds: BigInt(3600),
      nanos: 0,
    });
  });

  it("converts refresh token lifetime seconds to Duration", () => {
    const result = convertTokenLifetimesToDuration(undefined, 86400);

    expect(result.refreshTokenLifetime).toEqual({
      seconds: BigInt(86400),
      nanos: 0,
    });
  });

  it("converts both token lifetimes", () => {
    const result = convertTokenLifetimesToDuration(3600, 604800);

    expect(result.accessTokenLifetime).toEqual({
      seconds: BigInt(3600),
      nanos: 0,
    });
    expect(result.refreshTokenLifetime).toEqual({
      seconds: BigInt(604800),
      nanos: 0,
    });
  });

  it("returns undefined when access token lifetime is not set", () => {
    const result = convertTokenLifetimesToDuration(undefined, undefined);

    expect(result.accessTokenLifetime).toBeUndefined();
  });

  it("returns undefined when refresh token lifetime is not set", () => {
    const result = convertTokenLifetimesToDuration(undefined, undefined);

    expect(result.refreshTokenLifetime).toBeUndefined();
  });

  it("handles minimum valid values", () => {
    const result = convertTokenLifetimesToDuration(60, 60);

    expect(result.accessTokenLifetime).toEqual({
      seconds: BigInt(60),
      nanos: 0,
    });
    expect(result.refreshTokenLifetime).toEqual({
      seconds: BigInt(60),
      nanos: 0,
    });
  });

  it("handles maximum valid values", () => {
    const result = convertTokenLifetimesToDuration(
      86400, // 1 day
      604800, // 7 days
    );

    expect(result.accessTokenLifetime).toEqual({
      seconds: BigInt(86400),
      nanos: 0,
    });
    expect(result.refreshTokenLifetime).toEqual({
      seconds: BigInt(604800),
      nanos: 0,
    });
  });

  it("nanos field is always 0", () => {
    const result = convertTokenLifetimesToDuration(3600, undefined);

    expect(result.accessTokenLifetime?.nanos).toBe(0);
  });
});
