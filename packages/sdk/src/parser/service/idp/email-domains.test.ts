import { describe, expect, test } from "vitest";
import { containsAllEmailDomains, hasImplicitAllEmailDomains } from "./email-domains";

describe("containsAllEmailDomains", () => {
  test.each([
    ["the all-domains entry", ["*"]],
    ["the all-domains entry alongside a hostname", ["example.com", "*"]],
    ["a padded all-domains entry", [" * "]],
  ])("reports %s", (_name, domains) => {
    expect(containsAllEmailDomains(domains)).toBe(true);
  });

  test.each([
    ["an empty list", []],
    ["hostnames only", ["example.com", "corp.example.com"]],
    ["a wildcard subdomain", ["*.example.com"]],
  ])("does not report %s", (_name, domains) => {
    expect(containsAllEmailDomains(domains)).toBe(false);
  });
});

describe("hasImplicitAllEmailDomains", () => {
  test.each([
    ["the policy is omitted", undefined],
    ["the policy sets no email domains", {}],
    ["allowedEmailDomains is empty", { allowedEmailDomains: [] }],
    [
      "allowedEmailDomains is empty and useNonEmailIdentifier is false",
      { useNonEmailIdentifier: false, allowedEmailDomains: [] },
    ],
  ])("reports that %s", (_name, policy) => {
    expect(hasImplicitAllEmailDomains(policy)).toBe(true);
  });

  test.each([
    ["a hostname is listed", { allowedEmailDomains: ["example.com"] }],
    ["the all-domains entry is listed", { allowedEmailDomains: ["*"] }],
    ["useNonEmailIdentifier is true", { useNonEmailIdentifier: true }],
    [
      "useNonEmailIdentifier is true and allowedEmailDomains is empty",
      { useNonEmailIdentifier: true, allowedEmailDomains: [] },
    ],
  ])("does not report that %s", (_name, policy) => {
    expect(hasImplicitAllEmailDomains(policy)).toBe(false);
  });
});
