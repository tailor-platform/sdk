function inspect(tailor: { idp: { Client: new () => unknown } }) {
  return new tailor.idp.Client();
}

export { inspect };
