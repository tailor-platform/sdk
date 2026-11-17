import { assertType, describe, test } from "vitest";
import type { IdpUserTargetFor, IdpUserTriggerOptionsFor } from "./idp-user-target.types";

interface TestIdpRegistry {
  "shop-idp": true;
}

type SingleOptions = IdpUserTargetFor<TestIdpRegistry>;
type MultiOptions = IdpUserTriggerOptionsFor<["created"], TestIdpRegistry>;

describe("single-event idpUser trigger options", () => {
  test("accepts a declared idp name and an omitted idp", () => {
    assertType<SingleOptions>({ idp: "shop-idp" });
    assertType<SingleOptions>({});
  });

  test("rejects an undeclared idp name without external: true", () => {
    // @ts-expect-error "backoffice-idp" is not declared in the registry
    assertType<SingleOptions>({ idp: "backoffice-idp" });
    // @ts-expect-error typo'd idp name
    assertType<SingleOptions>({ idp: "shop-idpp" });
  });

  test("accepts an undeclared idp name with external: true", () => {
    assertType<SingleOptions>({ idp: "backoffice-idp", external: true });
    assertType<SingleOptions>({ idp: "shop-idp", external: true });
  });

  test("rejects external: true without an idp name", () => {
    // @ts-expect-error idp is required when external is true
    assertType<SingleOptions>({ external: true });
  });

  test("accepts any idp name when the registry is empty", () => {
    assertType<IdpUserTargetFor<Record<never, never>>>({ idp: "anything" });
  });
});

describe("multi-event idpUser trigger options", () => {
  test("accepts a declared idp name and an omitted idp", () => {
    assertType<MultiOptions>({ events: ["created"], idp: "shop-idp" });
    assertType<MultiOptions>({ events: ["created"] });
  });

  test("rejects an undeclared idp name without external: true", () => {
    // @ts-expect-error "backoffice-idp" is not declared in the registry
    assertType<MultiOptions>({ events: ["created"], idp: "backoffice-idp" });
  });

  test("accepts an undeclared idp name with external: true", () => {
    assertType<MultiOptions>({ events: ["created"], idp: "backoffice-idp", external: true });
  });

  test("rejects external: true without an idp name", () => {
    // @ts-expect-error idp is required when external is true
    assertType<MultiOptions>({ events: ["created"], external: true });
  });
});
