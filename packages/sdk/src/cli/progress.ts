export function createProgress(label: string, total: number) {
  let current = 0;

  const update = () => {
    current += 1;
    const percent = Math.round((current / total) * 100);
    process.stdout.write(`\r${label} ${current}/${total} (${percent}%)`);
  };

  const finish = () => {
    process.stdout.write("\n");
  };

  return { update, finish };
}
