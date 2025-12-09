import { describe, it, expect } from "vitest";
import { ensureNoExternalVariablesInFieldScripts } from "./tailordb-field-script-external-var-guard";
import type { OperatorFieldConfig } from "@/configure/types/operator";

function makeFieldConfig(
  partial: Partial<OperatorFieldConfig>,
): OperatorFieldConfig {
  return {
    type: "string",
    ...partial,
  };
}

describe("ensureNoExternalVariablesInFieldScripts", () => {
  describe("validate scripts", () => {
    it("allows validate script that does not capture external variables", () => {
      const fieldConfig = makeFieldConfig({
        validate: [
          {
            script: {
              expr: "(({ value, data, user }) => { return !!value && !!data && !!user; })({ value: _value, data: _data, user: _user })",
            },
            errorMessage: "invalid",
          },
        ],
      });

      expect(() =>
        ensureNoExternalVariablesInFieldScripts("User", "name", fieldConfig),
      ).not.toThrow();
    });

    it("rejects validate script that captures external variables", () => {
      const fieldConfig = makeFieldConfig({
        validate: [
          {
            script: {
              expr: "(({ value }) => { return value === externalValue; })({ value: _value, data: _data, user: _user })",
            },
            errorMessage: "invalid",
          },
        ],
      });

      expect(() =>
        ensureNoExternalVariablesInFieldScripts("User", "name", fieldConfig),
      ).toThrow(
        "TailorDB validate for User.name captures external variables (externalValue). Hooks and validators must not reference variables outside their own parameters and local declarations.",
      );
    });

    it("rejects validate script that calls external helper function", () => {
      const fieldConfig = makeFieldConfig({
        validate: [
          {
            script: {
              expr: `
                (({ value }) => {
                  return isNonEmpty(value);
                })({ value: _value, data: _data, user: _user })
              `.trim(),
            },
            errorMessage: "invalid",
          },
        ],
      });

      expect(() =>
        ensureNoExternalVariablesInFieldScripts("User", "name", fieldConfig),
      ).toThrow(
        "TailorDB validate for User.name captures external variables (isNonEmpty). Hooks and validators must not reference variables outside their own parameters and local declarations.",
      );
    });
  });

  describe("hook scripts", () => {
    it("allows create hook that does not capture external variables", () => {
      const fieldConfig = makeFieldConfig({
        hooks: {
          create: {
            expr: "(({ value, data, user }) => { return value ?? data?.fallback ?? user.id; })({ value: _value, data: _data, user: _user })",
          },
        },
      });

      expect(() =>
        ensureNoExternalVariablesInFieldScripts("User", "email", fieldConfig),
      ).not.toThrow();
    });

    it("allows create hook that uses local variables and params", () => {
      const fieldConfig = makeFieldConfig({
        hooks: {
          create: {
            expr: `
              (({ value, data, user }) => {
                const email = value ?? data?.fallback ?? user.id;
                return email;
              })({ value: _value, data: _data, user: _user })
            `.trim(),
          },
        },
      });

      expect(() =>
        ensureNoExternalVariablesInFieldScripts("User", "email", fieldConfig),
      ).not.toThrow();
    });

    it("rejects create hook that captures external variables", () => {
      const fieldConfig = makeFieldConfig({
        hooks: {
          create: {
            expr: "(({ value }) => { return value ?? emptyEmail; })({ value: _value, data: _data, user: _user })",
          },
        },
      });

      expect(() =>
        ensureNoExternalVariablesInFieldScripts("User", "email", fieldConfig),
      ).toThrow(
        "TailorDB hook.create for User.email captures external variables (emptyEmail). Hooks and validators must not reference variables outside their own parameters and local declarations.",
      );
    });

    it("rejects create hook that calls external helper function", () => {
      const fieldConfig = makeFieldConfig({
        hooks: {
          create: {
            expr: `
              (({ value }) => {
                return formatEmail(value);
              })({ value: _value, data: _data, user: _user })
            `.trim(),
          },
        },
      });

      expect(() =>
        ensureNoExternalVariablesInFieldScripts("User", "email", fieldConfig),
      ).toThrow(
        "TailorDB hook.create for User.email captures external variables (formatEmail). Hooks and validators must not reference variables outside their own parameters and local declarations.",
      );
    });

    it("rejects update hook that captures external variables", () => {
      const fieldConfig = makeFieldConfig({
        hooks: {
          update: {
            expr: "(({ value }) => { return value ?? emptyEmail; })({ value: _value, data: _data, user: _user })",
          },
        },
      });

      expect(() =>
        ensureNoExternalVariablesInFieldScripts("User", "email", fieldConfig),
      ).toThrow(
        "TailorDB hook.update for User.email captures external variables (emptyEmail). Hooks and validators must not reference variables outside their own parameters and local declarations.",
      );
    });

    it("rejects update hook that calls external helper function", () => {
      const fieldConfig = makeFieldConfig({
        hooks: {
          update: {
            expr: `
              (({ value }) => {
                return formatEmail(value);
              })({ value: _value, data: _data, user: _user })
            `.trim(),
          },
        },
      });

      expect(() =>
        ensureNoExternalVariablesInFieldScripts("User", "email", fieldConfig),
      ).toThrow(
        "TailorDB hook.update for User.email captures external variables (formatEmail). Hooks and validators must not reference variables outside their own parameters and local declarations.",
      );
    });
  });
});
