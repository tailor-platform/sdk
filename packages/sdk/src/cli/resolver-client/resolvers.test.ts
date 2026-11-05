import { describe, expect, test } from "vitest";
import { listResolvers, renderResolverDeclarations } from "./resolvers";

const entry = (name: string, file: string) => ({ name, file, resolver: {} }) as never;

describe("renderResolverDeclarations", () => {
  test("derives the type of each resolver from the definition file it comes from", () => {
    const text = renderResolverDeclarations([entry("ping", "/app/resolvers/ping.ts")]);

    expect(text).toContain('import type definition0 from "/app/resolvers/ping";');
    expect(text).toContain("declare const resolver0: ResolverFunction<typeof definition0>;");
  });

  test("exports each resolver under its own name", () => {
    const text = renderResolverDeclarations([
      entry("ping", "/app/resolvers/ping.ts"),
      entry("greet", "/app/resolvers/greet.ts"),
    ]);

    expect(text).toContain('export { resolver0 as "ping" };');
    expect(text).toContain('export { resolver1 as "greet" };');
  });

  test("exports a resolver under its own name even when that is not a valid function name", () => {
    const text = renderResolverDeclarations([entry("get user", "/app/resolvers/get-user.ts")]);

    expect(text).toContain('export { resolver0 as "get user" };');
  });
});

describe("listResolvers", () => {
  test("lists the resolvers of every resolver service with the file defining each", async () => {
    const service = (resolvers: Record<string, { name: string }>) => ({
      loadResolvers: async () => {},
      resolvers,
    });
    const application = {
      resolverServices: [
        service({ "/app/a.ts": { name: "a" } }),
        service({ "/app/b.ts": { name: "b" } }),
      ],
    } as never;

    expect(await listResolvers(application)).toEqual([
      { name: "a", file: "/app/a.ts", resolver: { name: "a" } },
      { name: "b", file: "/app/b.ts", resolver: { name: "b" } },
    ]);
  });
});
