const runtime = globalThis;

function read(runtime: { tailor: { idp: { Client: unknown } } }) {
  return runtime.tailor.idp.Client;
}

export { read };
