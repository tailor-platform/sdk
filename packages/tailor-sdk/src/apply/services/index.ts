import chalk from "chalk";

export interface HasName {
  name: string;
}

export class ChangeSet<
  C extends HasName,
  U extends HasName,
  D extends HasName,
> {
  creates: C[] = [];
  updates: U[] = [];
  deletes: D[] = [];

  constructor(private title: string) {}

  print() {
    if (
      this.creates.length === 0 &&
      this.updates.length === 0 &&
      this.deletes.length === 0
    ) {
      return;
    }

    console.log(chalk.bold(`${this.title}:`));
    this.creates.forEach((item) => {
      console.log(chalk.green(`  + ${item.name}`));
    });
    this.deletes.forEach((item) => {
      console.log(chalk.red(`  - ${item.name}`));
    });
    this.updates.forEach((item) => {
      console.log(`  * ${item.name}`);
    });
  }
}
