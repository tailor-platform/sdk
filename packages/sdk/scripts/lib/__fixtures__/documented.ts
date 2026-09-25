/** Documented variable. */
export const documentedVar = "hello";

/** Documented function. */
export function documentedFunc(): void {}

/** Documented class. */
export class DocumentedClass {
  /**
   * Documented method.
   * @returns Greeting string
   */
  greet(): string {
    return "hi";
  }

  /**
   * Documented accessor.
   * @returns Name value
   */
  get name(): string {
    return "name";
  }

  /**
   * Documented static method.
   * @returns New instance
   */
  static create(): DocumentedClass {
    return new DocumentedClass();
  }

  private internalHelper(): void {}
  protected onEvent(): void {}
}

/** Documented enum. */
export enum DocumentedEnum {
  /** Member A. */
  A = "a",
  /** Member B. */
  B = "b",
}
