type Handler = {
  (tailor: unknown): void;
};

const client = new tailor.idp.Client();

export { client };
export type { Handler };
