import { describe, expect, test } from "vitest";
import { defineUnambiguousContextField } from "./unambiguous-context-field";

const options = { key: "auth", candidatesLabel: "Auth services", replacement: "auths" } as const;

describe("defineUnambiguousContextField", () => {
  test("sets the only candidate as an ordinary field", () => {
    const context = defineUnambiguousContextField(
      { baseDir: "out" },
      { ...options, candidates: { "corp-auth": { name: "corp-auth" } } },
    );

    expect(context.auth).toEqual({ name: "corp-auth" });
    expect({ ...context }).toEqual({ baseDir: "out", auth: { name: "corp-auth" } });
  });

  test("sets the field to undefined when there is no candidate", () => {
    const context = defineUnambiguousContextField(
      { baseDir: "out" },
      { ...options, candidates: {} },
    );

    expect(context.auth).toBeUndefined();
    expect(Object.keys(context)).toEqual(["baseDir", "auth"]);
  });

  describe("with several candidates", () => {
    const create = () =>
      defineUnambiguousContextField(
        { baseDir: "out" },
        {
          ...options,
          candidates: {
            "corp-auth": { name: "corp-auth" },
            "partner-auth": { name: "partner-auth" },
          },
        },
      );

    test("throws when the field is read, naming the field that replaces it", () => {
      const context = create();

      expect(() => context.auth).toThrow(
        expect.objectContaining({
          code: "PLUGIN_CONTEXT_FIELD_AMBIGUOUS",
          message:
            '"auth" cannot be read because the config has 2 Auth services: corp-auth, partner-auth.',
          suggestion: 'Change the code that reads "auth" to read "auths".',
          context: {
            field: "auth",
            replacement: "auths",
            candidates: ["corp-auth", "partner-auth"],
          },
        }),
      );
    });

    test("throws when the field is destructured", () => {
      const context = create();

      expect(() => {
        const { auth } = context;
        return auth;
      }).toThrow(expect.objectContaining({ code: "PLUGIN_CONTEXT_FIELD_AMBIGUOUS" }));
    });

    test("leaves the field out of a spread copy instead of throwing", () => {
      expect({ ...create() }).toEqual({ baseDir: "out" });
    });
  });
});
