import { styles, symbols } from "../../utils/logger";

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

  isEmpty(): boolean {
    return (
      this.creates.length === 0 &&
      this.updates.length === 0 &&
      this.deletes.length === 0
    );
  }

  print() {
    if (this.isEmpty()) {
      return;
    }

    console.log(styles.bold(`${this.title}:`));
    this.creates.forEach((item) => {
      console.log(`  ${symbols.create} ${item.name}`);
    });
    this.deletes.forEach((item) => {
      console.log(`  ${symbols.delete} ${item.name}`);
    });
    this.updates.forEach((item) => {
      console.log(`  ${symbols.update} ${item.name}`);
    });
  }
}
