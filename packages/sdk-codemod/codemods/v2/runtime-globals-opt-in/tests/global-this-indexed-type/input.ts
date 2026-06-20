const runtime = globalThis;

type TailorRuntime = (typeof globalThis)["tailor"];
type TailordbRuntime = typeof globalThis["tailordb"];
type AliasTailorRuntime = (typeof runtime)["tailor"];
type ErrorCtor = typeof globalThis["TailorErrors"];

export type { AliasTailorRuntime, ErrorCtor, TailorRuntime, TailordbRuntime };
