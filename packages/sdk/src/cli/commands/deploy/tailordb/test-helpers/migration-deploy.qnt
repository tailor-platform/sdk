// What one TailorDB namespace must hold while `tailor deploy` runs its pending migrations.
// migration-model.test.ts replays each simulated trace against applyTailorDB.
module migrationDeploy {
  type Table = str

  // Every table has a required field `name`, and may have a string field `f` and an enum field `e`.
  type FieldState =
    | Absent
    | Present({ required: bool, unique: bool })
  type EnumState =
    | NoEnum
    | Values(Set[str])
  type Shape = { f: FieldState, e: EnumState }
  type Schema = Table -> Shape

  type Maintenance =
    | DuringMigrations
    | DuringDeploy
    | Off

  type Step =
    | Start
    | Script(int)
    | Commit(int)
    | Held
    | Done

  pure val TABLES = Set("A", "B", "C")
  pure val ENUM_VALUES = Set("X", "Y")
  pure val MAX_MIGRATIONS = 4

  // history[0] is the baseline and history[i] the schema after migration i; the local
  // definitions equal the last one.
  var history: List[Schema]
  var scripted: Set[int]
  // A fresh workspace has no checkpoint and no tables.
  var fresh: bool
  // Last committed migration, whose schema the workspace holds when it is not fresh.
  var checkpoint: int
  var maintenance: Maintenance
  var step: Step
  // Tables and shapes the namespace holds at `step`.
  var tables: Schema
  // Whether every table the namespace holds at `step` is restricted, or none is.
  var restricted: bool

  pure val FIELD_STATES: Set[FieldState] =
    Set(Absent).union(Set(true, false).map(r => Set(true, false).map(u => Present({ required: r, unique: u }))).flatten())
  pure val ENUM_STATES: Set[EnumState] =
    Set(NoEnum).union(ENUM_VALUES.powerset().exclude(Set(Set())).map(vs => Values(vs)))
  pure val SHAPES: Set[Shape] = FIELD_STATES.map(f => ENUM_STATES.map(e => { f: f, e: e })).flatten()
  pure val PRESENCES: Set[Set[Table]] = TABLES.powerset().exclude(Set(Set()))

  pure def schemaOf(present: Set[Table], a: Shape, b: Shape, c: Shape): Schema =
    present.mapBy(t => if (t == "A") a else if (t == "B") b else c)

  pure def isPresent(f: FieldState): bool = match f { | Absent => false | Present(_) => true }
  pure def isRequired(f: FieldState): bool = match f { | Absent => false | Present(p) => p.required }
  pure def isUnique(f: FieldState): bool = match f { | Absent => false | Present(p) => p.unique }
  pure def hasEnum(e: EnumState): bool = match e { | NoEnum => false | Values(_) => true }
  pure def valuesOf(e: EnumState): Set[str] = match e { | NoEnum => Set() | Values(vs) => vs }

  // The changes existing records can refuse, which `migration generate` scaffolds a script for.
  // The model always runs that script, which gives it a step to check, though a user can skip it.
  pure def breaks(before: Shape, after: Shape): bool = or {
    not(isPresent(before.f)) and isRequired(after.f),
    isPresent(before.f) and isPresent(after.f) and not(isRequired(before.f)) and isRequired(after.f),
    isPresent(before.f) and isPresent(after.f) and not(isUnique(before.f)) and isUnique(after.f),
    hasEnum(before.e) and hasEnum(after.e) and not(valuesOf(before.e).subseteq(valuesOf(after.e))),
  }

  pure def breaking(prev: Schema, after: Schema): bool =
    prev.keys().intersect(after.keys()).exists(t => breaks(prev.get(t), after.get(t)))

  // The Pre-phase shape of a table a migration keeps, until Post-migration: a removed field stays as
  // it was, an added field is optional, and a modified field takes the looser side of each
  // constraint.
  pure def relax(before: Shape, after: Shape): Shape = {
    f: match before.f {
      | Absent => match after.f {
        | Absent => Absent
        | Present(a) => Present({ required: false, unique: a.unique })
      }
      | Present(b) => match after.f {
        | Absent => Present(b)
        | Present(a) => Present({ required: b.required and a.required, unique: b.unique and a.unique })
      }
    },
    e: match before.e {
      | NoEnum => after.e
      | Values(b) => match after.e {
        | NoEnum => Values(b)
        | Values(a) => Values(b.union(a))
      }
    },
  }

  // A migration's tables while its script runs; the tables it removes stay until its checkpoint
  // commits.
  pure def duringScript(prev: Schema, after: Schema): Schema =
    prev.keys().union(after.keys()).mapBy(t =>
      if (not(after.keys().contains(t))) prev.get(t)
      else if (not(prev.keys().contains(t))) after.get(t)
      else relax(prev.get(t), after.get(t)))

  // A migration's tables after Post-migration, when its checkpoint commits.
  pure def atCommit(prev: Schema, after: Schema): Schema =
    prev.keys().union(after.keys()).mapBy(t => if (after.keys().contains(t)) after.get(t) else prev.get(t))

  pure def lastOf(h: List[Schema]): Schema = h[h.length() - 1]

  action init = {
    nondet n = 1.to(MAX_MIGRATIONS).oneOf()
    nondet p0 = PRESENCES.oneOf()
    nondet p1 = PRESENCES.oneOf()
    nondet p2 = PRESENCES.oneOf()
    nondet p3 = PRESENCES.oneOf()
    nondet p4 = PRESENCES.oneOf()
    nondet a0 = SHAPES.oneOf()
    nondet b0 = SHAPES.oneOf()
    nondet c0 = SHAPES.oneOf()
    nondet a1 = SHAPES.oneOf()
    nondet b1 = SHAPES.oneOf()
    nondet c1 = SHAPES.oneOf()
    nondet a2 = SHAPES.oneOf()
    nondet b2 = SHAPES.oneOf()
    nondet c2 = SHAPES.oneOf()
    nondet a3 = SHAPES.oneOf()
    nondet b3 = SHAPES.oneOf()
    nondet c3 = SHAPES.oneOf()
    nondet a4 = SHAPES.oneOf()
    nondet b4 = SHAPES.oneOf()
    nondet c4 = SHAPES.oneOf()
    nondet isFresh = Bool.oneOf()
    nondet mode = Set(DuringMigrations, DuringDeploy, Off).oneOf()
    nondet committed = 0.to(n - 1).oneOf()
    nondet optionalScripts = 1.to(n).powerset().oneOf()
    val h = [
      schemaOf(p0, a0, b0, c0),
      schemaOf(p1, a1, b1, c1),
      schemaOf(p2, a2, b2, c2),
      schemaOf(p3, a3, b3, c3),
      schemaOf(p4, a4, b4, c4),
    ].slice(0, n + 1)
    val cp = if (isFresh) 0 else committed
    val start = if (isFresh) Map() else h[cp]
    all {
      history' = h,
      // A migration without a schema change comes from `--data-only`, which always has a script.
      scripted' = optionalScripts.union(1.to(n).filter(i => h[i] == h[i - 1] or breaking(h[i - 1], h[i]))),
      fresh' = isFresh,
      checkpoint' = cp,
      maintenance' = mode,
      step' = Start,
      tables' = start,
      restricted' = false,
    }
  }

  action enter(i: int): bool = {
    val shown = if (scripted.contains(i)) duringScript(history[i - 1], history[i]) else atCommit(history[i - 1], history[i])
    all {
      step' = if (scripted.contains(i)) Script(i) else Commit(i),
      tables' = shown,
      restricted' = maintenance != Off,
    }
  }

  // Every write is done, and a held maintenance mode still restricts the tables.
  action hold: bool = all {
    step' = Held,
    tables' = lastOf(history),
    restricted' = true,
  }

  action finish: bool = all {
    step' = Done,
    tables' = lastOf(history),
    restricted' = false,
  }

  action advance = all {
    history' = history,
    scripted' = scripted,
    fresh' = fresh,
    checkpoint' = checkpoint,
    maintenance' = maintenance,
    match step {
      | Start => enter(checkpoint + 1)
      | Script(i) => {
        val shown = atCommit(history[i - 1], history[i])
        all {
          step' = Commit(i),
          tables' = shown,
          restricted' = restricted,
        }
      }
      | Commit(i) =>
        if (i + 1 < history.length()) enter(i + 1)
        else if (maintenance == DuringDeploy) hold
        else finish
      | Held => finish
      | Done => all {
        false,
        step' = step,
        tables' = tables,
        restricted' = restricted,
      }
    },
  }
}
