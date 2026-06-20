type Fn = (tailor: unknown) => unknown;

const client = new tailor.idp.Client();

export type { Fn };
export { client };
