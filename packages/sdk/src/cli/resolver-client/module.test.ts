import { describe, expect, test } from "vitest";
import { renderResolverModule, renderTailorDBModule } from "./module";

const ADD = { field: "add", document: "query add($a: Int!) { add(a: $a) }" };

describe("renderResolverModule", () => {
  test("exports a function for each resolver that sends its operation with the variables it is given", () => {
    const code = renderResolverModule({ operations: [ADD] });

    expect(code).toContain(
      'import { callResolver, setResolverDefaults } from "@tailor-platform/sdk/client";',
    );
    expect(code).toContain(
      `const resolver0 = (variables) => callResolver(${JSON.stringify(ADD)}, variables);`,
    );
    expect(code).toContain("export { resolver0 as add };");
  });

  test("exports a resolver named like a reserved word or with a hyphen under that name", () => {
    const code = renderResolverModule({
      operations: [
        { field: "delete", document: "mutation delete { delete }" },
        { field: "get-user", document: "query get-user { get-user }" },
      ],
    });

    expect(code).toContain("export { resolver0 as delete };");
    expect(code).toContain('export { resolver1 as "get-user" };');
  });

  test("falls back to the url the build was given", () => {
    const code = renderResolverModule({ operations: [ADD], url: "https://xyz.erp.dev" });

    expect(code).toContain('setResolverDefaults({ url: "https://xyz.erp.dev" });');
  });

  test("leaves the fallback unset when the build was given no url", () => {
    expect(renderResolverModule({ operations: [ADD] })).not.toContain("setResolverDefaults({");
  });
});

const META = {
  typeName: "Order",
  one: "order",
  many: "orders",
  fields: { id: "id", amount: "amount" },
  sortable: true,
  relations: {},
};

describe("renderTailorDBModule", () => {
  test("exports the record operations of each type under the type's name", () => {
    const code = renderTailorDBModule({ types: [{ name: "Order", meta: META }] });

    expect(code).toContain(
      'import { createRecords, setResolverDefaults } from "@tailor-platform/sdk/client";',
    );
    expect(code).toContain(`const crud0 = createRecords(${JSON.stringify(META)});`);
    expect(code).toContain("export { crud0 as Order };");
  });

  test("exports a type under its name even when that is not a valid identifier", () => {
    const code = renderTailorDBModule({ types: [{ name: "order-line", meta: META }] });

    expect(code).toContain('export { crud0 as "order-line" };');
  });

  test("falls back to the url the build was given", () => {
    const code = renderTailorDBModule({ types: [], url: "https://xyz.erp.dev" });

    expect(code).toContain('setResolverDefaults({ url: "https://xyz.erp.dev" });');
  });
});
