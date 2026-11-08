import { Context, Effect } from "effect";
import { type Sexp, show } from "../02/sexp.ts";
import type { Primitive, Value } from "../06/execute.ts";
import type { PreludeValue } from "../09/kernel.ts";
import { standard } from "../09/prelude.ts";
import { data, fun, num, row, type Type, unit } from "../09/types.ts";

// #region services
// What a host can do for a vendor policy: look up a vendor's risk
// score, and ask someone to approve a vendor. Each is an Effect
// service, so each host decides what it means.
interface DirectoryShape {
  readonly risk: (vendor: string) => Effect.Effect<number>;
}
export class Directory extends Context.Service<
  Directory,
  DirectoryShape
>()("Directory") {}

interface ApprovalsShape {
  readonly request: (
    owner: string,
    vendor: string,
  ) => Effect.Effect<void>;
}
export class Approvals extends Context.Service<
  Approvals,
  ApprovalsShape
>()("Approvals") {}

export interface Capabilities {
  readonly directory: DirectoryShape;
  readonly approvals: ApprovalsShape;
}
// #endregion services

const primitive = (name: string, apply: Primitive["apply"]): Value => ({
  _tag: "Primitive",
  name,
  apply,
});
const nil: Value = { _tag: "List", items: [], span: { start: 0, end: 0 } };
const text = (value: Value | undefined) => show(value as Sexp);
const e: Type = { _tag: "TVar", id: 1 };

// #region values
// Part 9's values, plus two that use the capabilities. Their types
// say which capability each one needs.
export const values = ({ directory, approvals }: Capabilities) =>
  new Map<string, PreludeValue>([
    ...standard.values,
    ["risk", {
      scheme: {
        vars: [1],
        type: fun([data], num, row(["Directory"], e)),
      },
      value: primitive("risk", ([vendor]) =>
        directory.risk(text(vendor?.value)),
      ),
    }],
    ["ask", {
      scheme: {
        vars: [1],
        type: fun([data, data], unit, row(["Approvals"], e)),
      },
      value: primitive("ask", ([owner, vendor]) => {
        const who = text(owner?.value);
        const what = text(vendor?.value);
        return Effect.as(approvals.request(who, what), nil);
      }),
    }],
  ]);

// For hosts that only check. A program that needs a capability
// can't get past the checker there, so these are never called.
const missing = (what: string) => () =>
  Effect.die(new Error(`no ${what} in this host`));
export const unavailable: Capabilities = {
  directory: { risk: missing("Directory") },
  approvals: { request: missing("Approvals") },
};
// #endregion values
