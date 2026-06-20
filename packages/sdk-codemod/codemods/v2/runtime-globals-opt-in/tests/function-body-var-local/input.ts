function build() {
  if (ready) {
    var tailor = localClient;
  }
  return tailor.run();
}

export { build };
