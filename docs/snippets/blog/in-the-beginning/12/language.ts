import { readFileSync } from "node:fs";
import { Effect } from "effect";
import { Output } from "../04/capabilities.ts";
import type { Prelude } from "../09/kernel.ts";
import { standard } from "../09/prelude.ts";
import { compile, run } from "../09/run.ts";
import { showComputation } from "../09/types.ts";
import { readAll } from "../07/read.ts";
import { type Docs, standardDocs } from "../10/describe.ts";
import {
  Approvals,
  type Capabilities,
  Directory,
  unavailable,
  values,
} from "./capabilities.ts";
import { declare, toDoc, toForm, verify } from "./defform.ts";

// #region load
// Load a prelude written in the language. Each defform is read,
// checked, and added in order, so a form can use the ones above it.
export const load = (
  base: Prelude,
  baseDocs: Docs,
  source: string,
) =>
  Effect.gen(function* () {
    let prelude = base;
    let docs = baseDocs;
    for (const form of yield* readAll(source)) {
      const declared = yield* declare(form);
      yield* verify(prelude, declared);
      const forms = new Map(prelude.forms);
      forms.set(declared.name, toForm(declared));
      prelude = { ...prelude, forms };
      docs = { ...docs, [declared.name]: toDoc(declared) };
    }
    return { prelude, docs };
  });
// #endregion load

// #region language
// The vendor language: Part 9's forms, the capability values, and
// the forms in vendor.lisp.
export const vendorSource = readFileSync(
  new URL("./vendor.lisp", import.meta.url),
  "utf8",
);

export const vendorLanguage = (capabilities: Capabilities) =>
  load(
    { forms: standard.forms, values: values(capabilities) },
    standardDocs,
    vendorSource,
  );
// #endregion language

// #region hosts
// Editors and agents check policies but run nothing, so they need
// no capabilities.
export const typeOfPolicy = (source: string) =>
  Effect.gen(function* () {
    const { prelude } = yield* vendorLanguage(unavailable);
    const { core, effects } = yield* compile(prelude, source);
    return showComputation(core.type, effects);
  });

// A host that runs a policy gets its capabilities from Effect
// services, and names the effects it allows. Its type says what
// it needs: Directory, Approvals, and Output.
export const runPolicy = (
  source: string,
  allowed: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const directory = yield* Directory;
    const approvals = yield* Approvals;
    const capabilities = { directory, approvals };
    const { prelude } = yield* vendorLanguage(capabilities);
    return yield* run(prelude, source, allowed);
  });

// A dry run: a directory that takes a moment to answer, and an
// approvals service that writes requests down instead of sending
// them. Unknown vendors count as the highest risk.
export const dryRun = (
  source: string,
  scores: ReadonlyMap<string, number>,
) =>
  Effect.gen(function* () {
    const requested: string[] = [];
    yield* runPolicy(source, ["Directory", "Approvals"]).pipe(
      Effect.provideService(Directory, {
        risk: (vendor) =>
          Effect.as(Effect.sleep(10), scores.get(vendor) ?? 100),
      }),
      Effect.provideService(Approvals, {
        request: (owner, vendor) =>
          Effect.sync(() => {
            requested.push(`${owner} reviews ${vendor}`);
          }),
      }),
      Effect.provideService(Output, { print: () => Effect.void }),
    );
    return requested;
  });
// #endregion hosts
