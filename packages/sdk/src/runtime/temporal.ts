import type { Temporal as TemporalTypes } from "temporal-spec";

function getTemporal(): typeof TemporalTypes {
  const temporal = (globalThis as unknown as { Temporal?: typeof TemporalTypes }).Temporal;
  if (!temporal) {
    throw new ReferenceError(
      "Temporal is unavailable. Use the Tailor Platform runtime or the SDK tailor-runtime Vitest environment.",
    );
  }
  return temporal;
}

/**
 * Typed access to the runtime's Temporal API, without installing a polyfill.
 * Constructors are resolved on access so configuration files can load in Node.js.
 * @example
 * import { Temporal } from "@tailor-platform/sdk/runtime";
 * const tomorrow: Temporal.PlainDate = Temporal.Now.plainDateISO().add({ days: 1 });
 */
export const Temporal: typeof TemporalTypes = {
  get PlainDate() {
    return getTemporal().PlainDate;
  },
  get PlainTime() {
    return getTemporal().PlainTime;
  },
  get PlainDateTime() {
    return getTemporal().PlainDateTime;
  },
  get PlainYearMonth() {
    return getTemporal().PlainYearMonth;
  },
  get PlainMonthDay() {
    return getTemporal().PlainMonthDay;
  },
  get ZonedDateTime() {
    return getTemporal().ZonedDateTime;
  },
  get Duration() {
    return getTemporal().Duration;
  },
  get Instant() {
    return getTemporal().Instant;
  },
  get Now() {
    return getTemporal().Now;
  },
};

/** Temporal instance types supplied by the SDK, independent of TypeScript's lib settings. */
// Type-only merging supports Temporal.PlainDate annotations on the value import.
// oxlint-disable-next-line typescript/no-namespace
export declare namespace Temporal {
  /** The runtime Temporal.PlainDate instance. */
  type PlainDate = TemporalTypes.PlainDate;
  /** The runtime Temporal.PlainTime instance. */
  type PlainTime = TemporalTypes.PlainTime;
  /** The runtime Temporal.PlainDateTime instance. */
  type PlainDateTime = TemporalTypes.PlainDateTime;
  /** The runtime Temporal.PlainYearMonth instance. */
  type PlainYearMonth = TemporalTypes.PlainYearMonth;
  /** The runtime Temporal.PlainMonthDay instance. */
  type PlainMonthDay = TemporalTypes.PlainMonthDay;
  /** The runtime Temporal.ZonedDateTime instance. */
  type ZonedDateTime = TemporalTypes.ZonedDateTime;
  /** The runtime Temporal.Duration instance. */
  type Duration = TemporalTypes.Duration;
  /** The runtime Temporal.Instant instance. */
  type Instant = TemporalTypes.Instant;
}
