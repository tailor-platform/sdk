import { describe, it, expectTypeOf } from "vitest";
import type { CodeGenerator } from "@/cli/generator/types";
import type { CodeGeneratorBase } from "@/parser/generator-config";

describe("Generator type compatibility", () => {
  it("CodeGenerator should be assignable to CodeGeneratorBase", () => {
    expectTypeOf<CodeGenerator>().toExtend<CodeGeneratorBase>();
  });

  it("CodeGenerator implements all required CodeGeneratorBase properties", () => {
    type RequiredKeys = keyof CodeGeneratorBase;
    type GeneratorKeys = keyof CodeGenerator;

    expectTypeOf<RequiredKeys>().toEqualTypeOf<GeneratorKeys>();
  });

  it("CodeGenerator id and description are readonly strings", () => {
    expectTypeOf<CodeGenerator["id"]>().toEqualTypeOf<string>();
    expectTypeOf<CodeGenerator["description"]>().toEqualTypeOf<string>();
  });

  it("CodeGenerator methods are functions", () => {
    expectTypeOf<CodeGenerator["processType"]>().toBeFunction();
    expectTypeOf<CodeGenerator["processResolver"]>().toBeFunction();
    expectTypeOf<CodeGenerator["processExecutor"]>().toBeFunction();
    expectTypeOf<CodeGenerator["aggregate"]>().toBeFunction();
  });

  it("CodeGenerator optional methods are optional functions", () => {
    type ProcessTailorDBNamespace = CodeGenerator["processTailorDBNamespace"];
    type ProcessPipelineNamespace = CodeGenerator["processPipelineNamespace"];

    expectTypeOf<ProcessTailorDBNamespace>().toExtend<
      ((...args: any[]) => any) | undefined
    >();
    expectTypeOf<ProcessPipelineNamespace>().toExtend<
      ((...args: any[]) => any) | undefined
    >();
  });
});
