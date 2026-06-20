function read(globalThis: {
  tailor: { idp: { Client: unknown } };
  tailordb: { file: unknown };
}) {
  return [globalThis.tailor.idp.Client, globalThis["tailordb"].file];
}

function destructure(globalThis: { runtime: { tailor: string } }) {
  const {
    runtime: { tailor },
  } = globalThis;
  return tailor;
}

export { destructure, read };
