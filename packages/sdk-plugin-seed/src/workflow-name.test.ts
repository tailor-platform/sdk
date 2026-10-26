import { describe, expect, test } from "vitest";
import { seedWorkflowName } from "./workflow-name";

const PLATFORM_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const KINDS = ["tailordb", "idp-seed", "idp-list", "idp-truncate"];

describe("seedWorkflowName", () => {
  test("joins the kind and the namespace when the name fits", () => {
    expect(seedWorkflowName("tailordb", "tailordb")).toBe("tailor-seed-tailordb--tailordb");
  });

  test.each(KINDS)("keeps a %s name that is exactly 63 characters as it is", (kind) => {
    const room = 63 - `tailor-seed-${kind}--`.length;
    const namespace = "a".repeat(room);

    const name = seedWorkflowName(kind, namespace);

    expect(name).toBe(`tailor-seed-${kind}--${namespace}`);
    expect(name).toHaveLength(63);
  });

  test.each(KINDS)(
    "shortens a %s name to a valid platform name for a 63-character namespace",
    (kind) => {
      const name = seedWorkflowName(kind, "a".repeat(63));

      expect(name).toHaveLength(63);
      expect(name).toMatch(PLATFORM_NAME_PATTERN);
    },
  );

  test("keeps two long namespaces with the same start apart", () => {
    const first = seedWorkflowName("tailordb", `${"a".repeat(60)}-one`);
    const second = seedWorkflowName("tailordb", `${"a".repeat(60)}-two`);

    expect(first).not.toBe(second);
  });

  test("gives the same name to the same namespace every time", () => {
    const namespace = "b".repeat(63);

    expect(seedWorkflowName("idp-list", namespace)).toBe(seedWorkflowName("idp-list", namespace));
  });

  test("keeps a namespace that ends with a hyphen valid after it is cut", () => {
    const namespace = `${"c".repeat(40)}-${"d".repeat(22)}`;

    expect(seedWorkflowName("idp-truncate", namespace)).toMatch(PLATFORM_NAME_PATTERN);
  });
});
