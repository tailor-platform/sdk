import { logger, styles, symbols } from "../../utils/logger";

export interface HasName {
  name: string;
}

export type ChangeSet<C extends HasName, U extends HasName, D extends HasName> = {
  readonly title: string;
  readonly creates: C[];
  readonly updates: U[];
  readonly deletes: D[];
  isEmpty: () => boolean;
  print: () => void;
};

/**
 * Create a new ChangeSet for tracking resource changes.
 * @param title - Title for the change set
 * @returns Empty ChangeSet instance with isEmpty() and print() methods
 */
export function createChangeSet<C extends HasName, U extends HasName, D extends HasName>(
  title: string,
): ChangeSet<C, U, D> {
  const creates: C[] = [];
  const updates: U[] = [];
  const deletes: D[] = [];

  const isEmpty = (): boolean =>
    creates.length === 0 && updates.length === 0 && deletes.length === 0;

  return {
    title,
    creates,
    updates,
    deletes,
    isEmpty,
    print: () => {
      if (isEmpty()) {
        return;
      }
      logger.log(styles.bold(`${title}:`));
      creates.forEach((item) => logger.log(`  ${symbols.create} ${item.name}`));
      deletes.forEach((item) => logger.log(`  ${symbols.delete} ${item.name}`));
      updates.forEach((item) => logger.log(`  ${symbols.update} ${item.name}`));
    },
  };
}
