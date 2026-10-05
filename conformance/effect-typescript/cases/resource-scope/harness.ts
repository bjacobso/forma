import assert from "node:assert/strict";
import { Effect, Layer } from "effect";
import {
  Audit,
  Pool,
  publish,
  QueryFailed,
  regionalTotals,
  ReportStore,
  ReportStoreLive,
  type Row,
} from "./expected.js";

const rows: ReadonlyArray<Row> = [
  { region: "north", amount: 120 },
  { region: "south", amount: 80 },
  { region: "north", amount: 30 },
];

function adapters() {
  const events: string[] = [];
  const pool = Pool.of({
    open: (name) => Effect.sync(() => {
      events.push(`open ${name}`);
      return { id: name };
    }),
    close: (connection) => Effect.sync(() => {
      events.push(`close ${connection.id}`);
    }),
    query: (connection, sql) =>
      sql.startsWith("broken")
        ? Effect.fail(new QueryFailed({ query: sql }))
        : Effect.sync(() => {
            events.push(`query ${connection.id}: ${sql}`);
            return sql.startsWith("insert") ? [] : rows;
          }),
  });
  const audit = Audit.of({ record: (event) => Effect.sync(() => { events.push(`audit ${event}`); }) });
  const layer = Layer.mergeAll(Layer.succeed(Pool, pool), Layer.succeed(Audit, audit));
  return { events, layer };
}

export default async function check(): Promise<void> {
  {
    const { events, layer } = adapters();
    const totals = await Effect.runPromise(Effect.provide(regionalTotals("select"), layer));
    assert.deepEqual(totals, { north: 150, south: 80 });
    assert.deepEqual(events, [
      "open primary",
      "open replica",
      "query primary: select",
      "audit read 3 rows; replica replica idle",
      "close replica",
      "close primary",
      "audit report finished",
    ]);
  }

  {
    const { events, layer } = adapters();
    const failure = await Effect.runPromise(Effect.flip(Effect.provide(regionalTotals("broken select"), layer)));
    assert.ok(failure instanceof QueryFailed);
    assert.equal(failure.query, "broken select");
    // Both connections are released even though the query failed.
    assert.deepEqual(events, ["open primary", "open replica", "close replica", "close primary", "audit report finished"]);
  }

  {
    const { events, layer } = adapters();
    const program = Effect.gen(function* () {
      const grand = yield* publish("select");
      assert.equal(grand, 230);
      events.push("published");
      const store = yield* ReportStore;
      yield* store.save("audit", 1);
    });
    const app = Layer.provideMerge(ReportStoreLive, layer);
    await Effect.runPromise(Effect.provide(program, app));
    assert.deepEqual(events, [
      "open reports",
      "open primary",
      "open replica",
      "query primary: select",
      "audit read 3 rows; replica replica idle",
      "close replica",
      "close primary",
      "audit report finished",
      "query reports: insert grand-total 230",
      "audit publish attempted",
      "published",
      "query reports: insert audit 1",
      // The layer's connection is released when the layer is.
      "close reports",
    ]);
  }

  {
    const { events, layer } = adapters();
    const failure = await Effect.runPromise(
      Effect.flip(Effect.provide(publish("broken"), Layer.provideMerge(ReportStoreLive, layer))),
    );
    assert.equal(failure._tag, "QueryFailed");
    assert.equal(events.at(-2), "audit publish attempted");
    assert.equal(events.at(-1), "close reports");
  }
}
