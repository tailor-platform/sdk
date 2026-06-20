class Client {
  constructor(@inject tailor: string) {
    this.value = tailor;
  }

  value: string;
}

export { Client };
