class Client {
  constructor(
    private tailor: { run(): void },
    public TailorErrors: string,
  ) {
    tailor.run();
  }
}

export { Client };
