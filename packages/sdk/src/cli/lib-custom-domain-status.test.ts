import { expect, test } from "vitest";
import { CustomDomainStatus } from "./lib";

test("exports the custom domain status that listCustomDomains returns", () => {
  expect(CustomDomainStatus.ACTIVE).toBeTypeOf("number");
  expect(CustomDomainStatus.ACTIVE).not.toBe(CustomDomainStatus.PENDING);
});
