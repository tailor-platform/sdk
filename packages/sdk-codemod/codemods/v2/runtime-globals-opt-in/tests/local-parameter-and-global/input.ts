function inspect(tailor: { idp: { Client: new () => unknown } }) {
  return new tailor.idp.Client();
}

const client = new tailor.idp.Client();

export { client, inspect };
