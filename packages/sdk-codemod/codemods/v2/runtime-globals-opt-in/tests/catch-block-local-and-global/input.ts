try {
  run();
} catch (error) {
  {
    const tailor = localClient;
    tailor.run();
  }

  const client = new tailor.idp.Client();
  use(client);
}
