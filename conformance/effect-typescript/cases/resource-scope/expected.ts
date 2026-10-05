import { Context, Effect, Layer, Option, Record, Schema, Scope } from "effect";

export const Connection = Schema.Struct({
  id: Schema.String,
});
export type Connection = typeof Connection.Type;

export const Row = Schema.Struct({
  region: Schema.String,
  amount: Schema.Int,
});
export type Row = typeof Row.Type;

export class QueryFailed extends Schema.TaggedError<QueryFailed>()("QueryFailed", {
  query: Schema.String,
}) {}

export class Pool extends Context.Service<
  Pool,
  {
    readonly open: (name: string) => Effect.Effect<Connection>;
    readonly close: (connection: Connection) => Effect.Effect<void>;
    readonly query: (connection: Connection, sql: string) => Effect.Effect<ReadonlyArray<Row>, QueryFailed>;
  }
>()("Pool") {}

export class Audit extends Context.Service<
  Audit,
  {
    readonly record: (event: string) => Effect.Effect<void>;
  }
>()("Audit") {}

export class ReportStore extends Context.Service<
  ReportStore,
  {
    readonly save: (name: string, total: number) => Effect.Effect<void, QueryFailed>;
  }
>()("ReportStore") {}

export const addRow = (
  totals: { readonly [key: string]: number },
  row: Row,
): { readonly [key: string]: number } => ({
  ...totals,
  [row.region]: Option.getOrElse(Record.get(totals, row.region), (): number => 0) + row.amount,
});

export const connection = (name: string): Effect.Effect<Connection, never, Pool | Scope.Scope> =>
  Effect.gen(function* () {
    const pool = yield* Pool;
    return yield* Effect.acquireRelease(pool.open(name), (opened) => pool.close(opened));
  });

export const regionalTotals = (
  sql: string,
): Effect.Effect<{ readonly [key: string]: number }, QueryFailed, Audit | Pool> =>
  Effect.gen(function* () {
    const audit = yield* Audit;
    const pool = yield* Pool;
    return yield* Effect.scoped(Effect.gen(function* () {
      yield* Effect.addFinalizer(() => audit.record("report finished"));
      const primary = yield* connection("primary");
      const replica = yield* connection("replica");
      const rows = yield* pool.query(primary, sql);
      yield* audit.record(`read ${rows.length} rows; replica ${replica.id} idle`);
      return rows.reduce<{ readonly [key: string]: number }>(addRow, {});
    }));
  });

export const publish = (
  sql: string,
): Effect.Effect<number, QueryFailed, Audit | Pool | ReportStore> =>
  Effect.gen(function* () {
    const audit = yield* Audit;
    const reportStore = yield* ReportStore;
    return yield* Effect.ensuring(
      Effect.gen(function* () {
        const totals = yield* regionalTotals(sql);
        const grand = Record.values(totals).reduce((total, item) => total + item, 0);
        yield* reportStore.save("grand-total", grand);
        return grand;
      }),
      audit.record("publish attempted"),
    );
  });

export const ReportStoreLive: Layer.Layer<ReportStore, never, Pool> = Layer.effect(
  ReportStore,
  Effect.gen(function* () {
    const pool = yield* Pool;
    const store = yield* connection("reports");
    return ReportStore.of({
      save: (name, total) =>
        Effect.gen(function* () {
          yield* pool.query(store, `insert ${name} ${total}`);
          return;
        }),
    });
  }),
);
