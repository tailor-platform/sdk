interface Handler {
  handle(tailor: unknown): void;
}

const client = new tailor.idp.Client();

export { client };
export type { Handler };
