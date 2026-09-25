/**
 * Tests for `@tailor-platform/sdk/runtime/logger` typed wrappers.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, test } from "vitest";
import * as logger from "#/runtime/logger";
import { cleanupMocks, injectMocks, mockLogger } from "#/vitest/mock";

describe("@tailor-platform/sdk/runtime/logger", () => {
  beforeEach(() => {
    injectMocks(globalThis);
  });

  afterEach(() => {
    cleanupMocks(globalThis);
  });

  test("severity wrappers delegate to tailor.logger with message and attributes", () => {
    using log = mockLogger();

    logger.debug("d");
    logger.info("processed", { orderId: "o-1", total: 99.5 });
    logger.warn("w", { retries: [1, 2] });
    logger.error("boom");

    expect(log.info).toHaveBeenCalledWith("processed", { orderId: "o-1", total: 99.5 });
    expect(log.calls).toEqual([
      { severity: "debug", message: "d", attributes: undefined },
      { severity: "info", message: "processed", attributes: { orderId: "o-1", total: 99.5 } },
      { severity: "warn", message: "w", attributes: { retries: [1, 2] } },
      { severity: "error", message: "boom", attributes: undefined },
    ]);
  });

  test("calls records mixed severities in invocation order, not grouped by severity", () => {
    using log = mockLogger();

    logger.info("first");
    logger.debug("second");
    logger.info("third");

    expect(log.calls.map((c) => c.message)).toEqual(["first", "second", "third"]);
  });

  test("setAttributes delegates to tailor.logger", () => {
    using log = mockLogger();

    logger.setAttributes({ requestId: "r-1" });

    expect(log.setAttributes).toHaveBeenCalledWith({ requestId: "r-1" });
  });

  test("base stub makes calls no-ops without an explicit mock", () => {
    expect(() => logger.info("no mock installed")).not.toThrow();
  });

  test("LogAttributeValue only allows OTel-representable types", () => {
    expectTypeOf<logger.LogAttributeValue>().toEqualTypeOf<
      string | number | boolean | readonly string[] | readonly number[] | readonly boolean[]
    >();
    expectTypeOf<logger.LogAttributes>().toEqualTypeOf<Record<string, logger.LogAttributeValue>>();
  });
});
