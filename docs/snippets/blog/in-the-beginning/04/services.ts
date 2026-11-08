import { Context, Effect } from "effect";

// #region services
class X extends Context.Service<X, number>()("X") {}

// A "function body" that reads X, defined where X is 1...
const body = Effect.gen(function* () {
  return (yield* X) + 0;
});
const defined = Effect.succeed(body).pipe(
  Effect.provideService(X, 1),
);

// ...and called where X is 100.
export const called = defined.pipe(
  Effect.flatMap((fn) => fn),
  Effect.provideService(X, 100),
);
// Effect.runSync(called) is 100: the body saw the caller's X.
// #endregion services
