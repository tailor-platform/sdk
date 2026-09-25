import { describe, expect, test } from "vitest";
import { publishEventsConflict, resolvePublishEvents } from "./publish-events";

// Built by the same helper deploy uses, so the expected messages below pin the
// resource labels as well as the sentence around them.
const conflict = publishEventsConflict.resolver("processOrder");

describe("resolvePublishEvents", () => {
  test.each([
    { explicit: true, subscribed: true, expected: true },
    { explicit: true, subscribed: false, expected: true },
    { explicit: false, subscribed: false, expected: false },
    { explicit: undefined, subscribed: true, expected: true },
    { explicit: undefined, subscribed: false, expected: false },
  ])(
    "resolves explicit=$explicit subscribed=$subscribed to $expected",
    ({ explicit, subscribed, expected }) => {
      expect(resolvePublishEvents({ explicit, subscribed, conflict })).toBe(expected);
    },
  );

  test("throws when an opt-out is combined with a subscriber", () => {
    expect(() => resolvePublishEvents({ explicit: false, subscribed: true, conflict })).toThrow(
      'Resolver "processOrder" has "publishEvents: false", but executors with resolverExecuted triggers subscribe to it. ' +
        'Either remove "publishEvents: false" or remove the matching executor triggers.',
    );
  });

  test("names what the subscribers subscribe to when it is not the resource itself", () => {
    expect(() =>
      resolvePublishEvents({
        explicit: false,
        subscribed: true,
        conflict: publishEventsConflict.workflowJob("process-order"),
      }),
    ).toThrow(
      'Job "process-order" has "publishEvents: false", but executors with workflowJobExecution triggers subscribe to a workflow that runs it.',
    );
  });
});
