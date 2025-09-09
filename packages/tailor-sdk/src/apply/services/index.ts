import { styleText } from "node:util";

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

    console.log(styleText("bold", `${this.title}:`));
    this.creates.forEach((item) => {
      console.log(styleText("green", `  + ${item.name}`));
    });
    this.deletes.forEach((item) => {
      console.log(styleText("red", `  - ${item.name}`));
    });
    this.updates.forEach((item) => {
      console.log(`  * ${item.name}`);
    });
  }
}
