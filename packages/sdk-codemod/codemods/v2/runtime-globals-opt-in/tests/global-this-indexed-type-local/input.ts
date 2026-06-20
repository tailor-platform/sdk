const globalThis = {
  tailor: {},
};

type TailorRuntime = (typeof globalThis)["tailor"];

export type { TailorRuntime };
