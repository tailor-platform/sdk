import { describe, expect, it } from "vitest";
import { db } from "@/configure/services/tailordb/schema";
import { parseFieldConfig } from "./field";

describe("parseFieldConfig", () => {
  describe("generated datetime hooks", () => {
    it("generates create hook for required generated datetime (createdAt)", () => {
      const { createdAt } = db.fields.timestamps();
      const config = parseFieldConfig(createdAt);

      expect(config.hooks).toBeDefined();
      expect(config.hooks?.create).toEqual({ expr: "new Date()" });
      expect(config.hooks?.update).toBeUndefined();
    });

    it("generates update hook for optional generated datetime (updatedAt)", () => {
      const { updatedAt } = db.fields.timestamps();
      const config = parseFieldConfig(updatedAt);

      expect(config.hooks).toBeDefined();
      expect(config.hooks?.create).toBeUndefined();
      expect(config.hooks?.update).toEqual({ expr: "new Date()" });
    });

    it("does not generate hooks for non-generated datetime", () => {
      const field = db.datetime();
      const config = parseFieldConfig(field);

      expect(config.hooks).toBeUndefined();
    });

    it("does not generate hooks for generated non-datetime field", () => {
      const field = db.string();
      // Manually set generated to simulate a non-datetime generated field
      (field as unknown as { _metadata: { generated: boolean } })._metadata.generated = true;
      const config = parseFieldConfig(field);

      expect(config.hooks).toBeUndefined();
    });

    it("skips auto-generated hooks when skipAutoHooks is true", () => {
      const { createdAt, updatedAt } = db.fields.timestamps();

      expect(parseFieldConfig(createdAt, { skipAutoHooks: true }).hooks).toBeUndefined();
      expect(parseFieldConfig(updatedAt, { skipAutoHooks: true }).hooks).toBeUndefined();
    });
  });
});
