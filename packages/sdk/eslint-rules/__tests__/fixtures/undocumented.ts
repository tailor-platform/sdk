export const undocumentedVar = 42;

export function undocumentedFunc(): void {}

export class UndocumentedClass {
  undocumentedMethod(): void {}

  get undocumentedAccessor(): number {
    return 0;
  }
}

export enum UndocumentedEnum {
  X = "x",
  Y = "y",
}
