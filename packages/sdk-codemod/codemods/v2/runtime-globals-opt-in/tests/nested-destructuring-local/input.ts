const { x: [tailor] } = obj;

function run({ x: { tailordb } }: { x: { tailordb: { run(): void } } }) {
  tailordb.run();
}

export { run, tailor };
