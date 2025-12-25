import { describe, it, expect, expectTypeOf } from "vitest";
import {
  hasDependency,
  type CodeGenerator,
  type TailorDBGenerator,
  type ResolverGenerator,
  type ExecutorGenerator,
  type TailorDBResolverGenerator,
  type FullCodeGenerator,
  type AnyCodeGenerator,
  type DependencyKind,
} from "@/cli/generator/types";
import type { CodeGeneratorBase } from "@/parser/generator-config";

describe("Generator type compatibility", () => {
  describe("TailorDBGenerator", () => {
    it("should have tailordb dependency", () => {
      expectTypeOf<TailorDBGenerator["dependencies"]>().toEqualTypeOf<
        readonly ["tailordb"]
      >();
    });

    it("should have processType method", () => {
      expectTypeOf<TailorDBGenerator["processType"]>().toBeFunction();
    });

    it("should have aggregate method", () => {
      expectTypeOf<TailorDBGenerator["aggregate"]>().toBeFunction();
    });

    it("should not have processResolver or processExecutor", () => {
      type Keys = keyof TailorDBGenerator;
      expectTypeOf<"processResolver">().not.toEqualTypeOf<Keys>();
      expectTypeOf<"processExecutor">().not.toEqualTypeOf<Keys>();
    });
  });

  describe("ResolverGenerator", () => {
    it("should have resolver dependency", () => {
      expectTypeOf<ResolverGenerator["dependencies"]>().toEqualTypeOf<
        readonly ["resolver"]
      >();
    });

    it("should have processResolver method", () => {
      expectTypeOf<ResolverGenerator["processResolver"]>().toBeFunction();
    });

    it("should have aggregate method", () => {
      expectTypeOf<ResolverGenerator["aggregate"]>().toBeFunction();
    });

    it("should not have processType or processExecutor", () => {
      type Keys = keyof ResolverGenerator;
      expectTypeOf<"processType">().not.toEqualTypeOf<Keys>();
      expectTypeOf<"processExecutor">().not.toEqualTypeOf<Keys>();
    });
  });

  describe("ExecutorGenerator", () => {
    it("should have executor dependency", () => {
      expectTypeOf<ExecutorGenerator["dependencies"]>().toEqualTypeOf<
        readonly ["executor"]
      >();
    });

    it("should have processExecutor method", () => {
      expectTypeOf<ExecutorGenerator["processExecutor"]>().toBeFunction();
    });

    it("should have aggregate method", () => {
      expectTypeOf<ExecutorGenerator["aggregate"]>().toBeFunction();
    });

    it("should not have processType or processResolver", () => {
      type Keys = keyof ExecutorGenerator;
      expectTypeOf<"processType">().not.toEqualTypeOf<Keys>();
      expectTypeOf<"processResolver">().not.toEqualTypeOf<Keys>();
    });
  });

  describe("TailorDBResolverGenerator", () => {
    it("should have tailordb and resolver dependencies", () => {
      expectTypeOf<TailorDBResolverGenerator["dependencies"]>().toEqualTypeOf<
        readonly ["tailordb", "resolver"]
      >();
    });

    it("should have both processType and processResolver methods", () => {
      expectTypeOf<TailorDBResolverGenerator["processType"]>().toBeFunction();
      expectTypeOf<
        TailorDBResolverGenerator["processResolver"]
      >().toBeFunction();
    });

    it("should not have processExecutor", () => {
      type Keys = keyof TailorDBResolverGenerator;
      expectTypeOf<"processExecutor">().not.toEqualTypeOf<Keys>();
    });
  });

  describe("FullCodeGenerator", () => {
    it("should have all dependencies", () => {
      expectTypeOf<FullCodeGenerator["dependencies"]>().toEqualTypeOf<
        readonly ["tailordb", "resolver", "executor"]
      >();
    });

    it("should have all process methods", () => {
      expectTypeOf<FullCodeGenerator["processType"]>().toBeFunction();
      expectTypeOf<FullCodeGenerator["processResolver"]>().toBeFunction();
      expectTypeOf<FullCodeGenerator["processExecutor"]>().toBeFunction();
    });

    it("should have aggregate method", () => {
      expectTypeOf<FullCodeGenerator["aggregate"]>().toBeFunction();
    });
  });

  describe("AnyCodeGenerator", () => {
    it("should have optional process methods", () => {
      type ProcessType = AnyCodeGenerator["processType"];
      type ProcessResolver = AnyCodeGenerator["processResolver"];
      type ProcessExecutor = AnyCodeGenerator["processExecutor"];

      // These methods are optional (can be undefined or a function)
      expectTypeOf<undefined>().toExtend<ProcessType>();
      expectTypeOf<undefined>().toExtend<ProcessResolver>();
      expectTypeOf<undefined>().toExtend<ProcessExecutor>();
    });

    it("should be assignable to CodeGeneratorBase", () => {
      expectTypeOf<AnyCodeGenerator>().toExtend<CodeGeneratorBase>();
    });
  });

  describe("hasDependency runtime utility", () => {
    it("should return true when dependency exists", () => {
      const gen = { dependencies: ["tailordb", "resolver"] as const };
      expect(hasDependency(gen, "tailordb")).toBe(true);
      expect(hasDependency(gen, "resolver")).toBe(true);
    });

    it("should return false when dependency does not exist", () => {
      const gen = { dependencies: ["tailordb"] as const };
      expect(hasDependency(gen, "resolver")).toBe(false);
      expect(hasDependency(gen, "executor")).toBe(false);
    });
  });

  describe("CodeGenerator generic type", () => {
    it("should correctly infer dependencies from type parameter", () => {
      type TestGen = CodeGenerator<readonly ["tailordb"]>;
      expectTypeOf<TestGen["dependencies"]>().toEqualTypeOf<
        readonly ["tailordb"]
      >();
    });

    it("should be compatible with readonly dependency arrays", () => {
      type ReadonlyDeps = readonly DependencyKind[];
      const deps: ReadonlyDeps = ["tailordb", "resolver"];
      expect(deps).toContain("tailordb");
    });
  });
});
