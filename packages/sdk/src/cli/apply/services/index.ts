import { logger, styles, symbols } from "../../utils/logger";

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

    logger.log(styles.bold(`${this.title}:`));
    this.creates.forEach((item) => {
      logger.log(`  ${symbols.create} ${item.name}`);
    });
    this.deletes.forEach((item) => {
      logger.log(`  ${symbols.delete} ${item.name}`);
    });
    this.updates.forEach((item) => {
      logger.log(`  ${symbols.update} ${item.name}`);
    });
  }
}
