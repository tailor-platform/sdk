async function run(clients: AsyncIterable<{ run(): void }>) {
  for await (const tailor of clients) {
    tailor.run();
  }
}

export { run };
