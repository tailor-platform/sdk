/**
 * Probe that records how many overlapping invocations of a mocked async
 * operation are in flight. Each `run` call yields one macrotask so
 * concurrent callers can overlap before it resolves:
 *
 * ```ts
 * const probe = createConcurrencyProbe();
 * const client = { updateThing: vi.fn().mockImplementation(probe.run) };
 * // ...exercise code under test...
 * expect(probe.maxInFlight()).toBeGreaterThan(1);
 * ```
 * @returns A probe with a `run` mock implementation and a `maxInFlight` reader
 */
export function createConcurrencyProbe() {
  let inFlight = 0;
  let maxInFlight = 0;
  return {
    run: async (): Promise<object> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return {};
    },
    maxInFlight: () => maxInFlight,
  };
}
