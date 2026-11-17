import type { IdpNameForRegistry } from "#/configure/types/idp-name";

/**
 * The IdP an `idpUser` trigger subscribes to, with `idp` narrowed by registry `R`.
 *
 * Generic over the registry so type-level tests can use a disposable registry shape.
 */
export type IdpUserTargetFor<R> =
  | {
      /**
       * IdP namespace name to subscribe to. Required when the project defines
       * multiple IdPs; optional when a single IdP exists. Must match an IdP the
       * config declares in `defineConfig({ idp })`, or one owned by another
       * config deployed in the same run.
       */
      idp?: IdpNameForRegistry<R>;
      external?: false;
    }
  | {
      /**
       * Name of an IdP that this config does not declare and another config
       * deployed in the same run owns.
       */
      idp: IdpNameForRegistry<R> | (string & Record<never, never>);
      /**
       * Marks `idp` as owned by another config, so the name is not checked
       * against the generated `IdpName` type.
       */
      external: true;
    };

/**
 * Options of the multi-event `idpUser` trigger, with `idp` narrowed by registry `R`.
 */
export type IdpUserTriggerOptionsFor<K, R> = { events: K } & IdpUserTargetFor<R>;
