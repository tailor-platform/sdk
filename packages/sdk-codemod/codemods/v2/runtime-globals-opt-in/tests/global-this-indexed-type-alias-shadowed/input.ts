const runtime = globalThis;

function read(runtime: { tailor: unknown }) {
  type TailorRuntime = (typeof runtime)["tailor"];
  return null as TailorRuntime;
}

export { read };
