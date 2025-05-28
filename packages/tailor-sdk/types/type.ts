abstract class TailorTypeField<const Output> {
  public readonly _output = undefined as Output;
}

abstract class TailorType<
  const F extends { id?: never } & Record<string, TailorTypeField<any>>,
> {
  constructor(
    public readonly name: string,
    public readonly fields: F,
  ) {}
}

export type ReferenceConfig<
  T extends InstanceType<typeof TailorType> = InstanceType<
    typeof TailorType
  >,
  M extends [string, string] = [string, string],
> = {
  nameMap: M;
  type: T;
  field?: keyof T["fields"];
};
