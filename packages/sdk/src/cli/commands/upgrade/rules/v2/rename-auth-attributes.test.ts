import { describe, expect, it } from "vitest";
import { runFixtureTest } from "../../__test_fixtures__/fixture-helper";
import { renameAuthAttributesRule } from "./rename-auth-attributes";

describe("rename-auth-attributes rule", () => {
  it("should rename attributes/attributeList in defineAuth and context.user access", async () => {
    await runFixtureTest("v2/rename-auth-attributes", renameAuthAttributesRule.transformSource);
  });

  it("should return null for code without defineAuth or context.user.attributes", () => {
    const source = `
import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "myResolver",
  operation: "query",
  body: () => ({ value: 42 }),
  output: t.int(),
});
`;
    expect(renameAuthAttributesRule.transformSource(source)).toBeNull();
  });

  it("should not rename attributes on non-user receivers", () => {
    const source = `
const config = { attributes: { foo: true } };
const element = document.body.attributes;
const data = someObj.attributes;
`;
    expect(renameAuthAttributesRule.transformSource(source)).toBeNull();
  });

  it("should handle only defineAuth config (no runtime access)", () => {
    const source = `import { defineAuth } from "@tailor-platform/sdk";

export const auth = defineAuth("auth", {
  userProfile: {
    type: user,
    usernameField: "email",
    attributes: { role: true },
  },
});
`;
    const result = renameAuthAttributesRule.transformSource(source);
    expect(result).not.toBeNull();
    expect(result).toContain("map: { role: true }");
    expect(result).not.toContain("attributes");
  });

  it("should handle only runtime context.user access (no defineAuth)", () => {
    const source = `import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "info",
  operation: "query",
  body: (context) => {
    return { role: context.user.attributes?.role };
  },
  output: t.object({ role: t.string() }),
});
`;
    const result = renameAuthAttributesRule.transformSource(source);
    expect(result).not.toBeNull();
    expect(result).toContain("context.user.map?.role");
    expect(result).not.toContain("context.user.attributes");
  });

  it("should handle attributeList in runtime access", () => {
    const source = `const groups = context.user.attributeList;
`;
    const result = renameAuthAttributesRule.transformSource(source);
    expect(result).not.toBeNull();
    expect(result).toContain("context.user.uuidList");
    expect(result).not.toContain("attributeList");
  });
});
