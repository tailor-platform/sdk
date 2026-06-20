function* inspect(tailor: unknown) {
  yield tailor;
}

const client = new tailor.idp.Client();

export { client, inspect };
