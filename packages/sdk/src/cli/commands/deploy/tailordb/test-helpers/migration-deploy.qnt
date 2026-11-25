// What one TailorDB namespace must hold while `tailor deploy` runs its pending migrations.
// migration-model.test.ts replays each simulated trace against applyTailorDB.
module migrationDeploy {
  // Version v of a table has the optional fields f1..fv.
  type Table = str
  type Schema = Table -> int

  type Step =
    | Start
    | Script(int)
    | Commit(int)
    | Done

  pure val TABLES = Set("A", "B", "C")
  pure val MAX_VERSION = 2
  pure val MAX_MIGRATIONS = 4

  // history[0] is the baseline and history[i] the schema after migration i; the local
  // definitions equal the last one.
  var history: List[Schema]
  var scripted: Set[int]
  // A fresh workspace has no checkpoint and no tables.
  var fresh: bool
  // Last committed migration, whose schema the workspace holds when it is not fresh.
  var checkpoint: int
  var step: Step
  // Tables and versions the namespace holds at `step`, except the tables in `unchecked`.
  var tables: Schema
  // Tables with a GraphQL permission: every table at Start, and the ones checked at Done.
  var permissions: Set[Table]
  var unchecked: Set[Table]

  pure val SCHEMAS: Set[Schema] =
    TABLES.powerset().exclude(Set(Set())).map(names => names.setOfMaps(1.to(MAX_VERSION))).flatten()

  // A version only grows while its table stays, since a removed field stays until Post-migration.
  pure def follows(prev: Schema, after: Schema): bool =
    after.keys().forall(t => not(prev.keys().contains(t)) or after.get(t) >= prev.get(t))

  // A migration's tables, with the ones it removes kept until its checkpoint commits.
  pure def during(prev: Schema, after: Schema): Schema =
    prev.keys().union(after.keys()).mapBy(t => if (after.keys().contains(t)) after.get(t) else prev.get(t))

  pure def maxOf(values: Set[int]): int = values.fold(-1, (acc, v) => if (v > acc) v else acc)

  // The migration that last added `t` at or before schema `i`; 0 when it is in the baseline.
  pure def addedAt(h: List[Schema], t: Table, i: int): int =
    maxOf(0.to(i).filter(j => j.to(i).forall(m => h[m].keys().contains(t)) and (j == 0 or not(h[j - 1].keys().contains(t)))))

  pure def lastOf(h: List[Schema]): Schema = h[h.length() - 1]

  // Known gap: a table the local definitions lack is never created when a pending migration adds it.
  pure def intermediateTables(h: List[Schema], cp: int, i: int): Set[Table] =
    h[i - 1].keys().union(h[i].keys()).filter(t =>
      not(lastOf(h).keys().contains(t)) and
      addedAt(h, t, if (h[i].keys().contains(t)) i else i - 1) > cp)

  // Known gap: a table the workspace has and the local definitions keep is neither deleted when a
  // pending migration removes it nor written with the schemas of the migrations before that.
  pure def readdedTables(h: List[Schema], start: Schema, cp: int): Set[Table] =
    start.keys().intersect(lastOf(h).keys()).filter(t => (cp + 1).to(h.length() - 1).exists(j => not(h[j].keys().contains(t))))

  pure def uncheckedAt(h: List[Schema], start: Schema, cp: int, i: int): Set[Table] =
    intermediateTables(h, cp, i).union(readdedTables(h, start, cp))

  action init = {
    nondet n = 1.to(MAX_MIGRATIONS).oneOf()
    nondet s0 = SCHEMAS.oneOf()
    nondet s1 = SCHEMAS.filter(s => follows(s0, s)).oneOf()
    nondet s2 = SCHEMAS.filter(s => follows(s1, s)).oneOf()
    nondet s3 = SCHEMAS.filter(s => follows(s2, s)).oneOf()
    nondet s4 = SCHEMAS.filter(s => follows(s3, s)).oneOf()
    nondet isFresh = Bool.oneOf()
    nondet committed = 0.to(n - 1).oneOf()
    nondet withScript = 1.to(n).powerset().oneOf()
    val h = [s0, s1, s2, s3, s4].slice(0, n + 1)
    val cp = if (isFresh) 0 else committed
    val start = if (isFresh) Map() else h[cp]
    all {
      history' = h,
      scripted' = withScript,
      fresh' = isFresh,
      checkpoint' = cp,
      step' = Start,
      tables' = start,
      permissions' = start.keys(),
      unchecked' = Set(),
    }
  }

  action enter(i: int): bool = all {
    step' = if (scripted.contains(i)) Script(i) else Commit(i),
    tables' = during(history[i - 1], history[i]),
    permissions' = permissions,
    unchecked' = uncheckedAt(history, if (fresh) Map() else history[checkpoint], checkpoint, i),
  }

  action finish: bool = all {
    step' = Done,
    tables' = lastOf(history),
    permissions' = lastOf(history).keys(),
    unchecked' = Set(),
  }

  action advance = all {
    history' = history,
    scripted' = scripted,
    fresh' = fresh,
    checkpoint' = checkpoint,
    match step {
      | Start => enter(checkpoint + 1)
      | Script(i) => all { step' = Commit(i), tables' = tables, permissions' = permissions, unchecked' = unchecked }
      | Commit(i) => if (i + 1 < history.length()) enter(i + 1) else finish
      | Done => all { false, step' = step, tables' = tables, permissions' = permissions, unchecked' = unchecked }
    },
  }
}
