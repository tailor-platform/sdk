try {
  run();
} catch {
  const client = new tailor.idp.Client();
  use(client);
}
