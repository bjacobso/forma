import { ordersSource } from "../effectPageSources";
import domainSource from "../../../../examples/http-rpc/domain.lisp?raw";
import httpSource from "../../../../examples/http-rpc/http.lisp?raw";
import rpcSource from "../../../../examples/http-rpc/rpc.lisp?raw";
import type { SourceFile } from "./protocol";

export interface ReadingExample {
  readonly id: string;
  readonly label: string;
  readonly blurb: string;
  /** The first file opens first. */
  readonly files: readonly SourceFile[];
  /** Text to select when the example opens, in the first file. */
  readonly focus?: string;
}

const single = (example: Omit<ReadingExample, "files"> & { readonly source: string }): ReadingExample => {
  const { source, ...rest } = example;
  return { ...rest, files: [{ id: "main.lisp", source }] };
};

export const readingExamples: readonly ReadingExample[] = [
  single({
    id: "functions",
    label: "Plain functions",
    blurb: "Inferred without annotations: row-polymorphic records, generic maps, higher-order functions.",
    focus: "(define older",
    source: `; Nothing here is annotated. Hover any form, or select one and press Alt-Up.

(define average [xs]
  (/ (reduce + 0 xs) (count xs)))

(define lookup [m k] (get m k))

(define older [person]
  (assoc person :age (+ (get person :age) 1)))

(define twice [f x] (f (f x)))

(define ada {:name "Ada" :age 36})

(let [scores [90 82 77]]
  (average scores))`,
  }),
  single({
    id: "effect",
    label: "Effect operation",
    blurb: "Every Effect form carries its success type, the errors it can fail with, and the services it needs.",
    focus: "(retry (Payments.charge",
    source: ordersSource,
  }),
  {
    id: "service",
    label: "RPC + HTTP · 3 files",
    blurb: "examples/http-rpc: a domain module imported by an RPC group and an HTTP API. Click a type to jump between files.",
    focus: "(rpc \"ReserveSeats\"",
    files: [
      { id: "rpc.lisp", source: rpcSource },
      { id: "domain.lisp", source: domainSource },
      { id: "http.lisp", source: httpSource },
    ],
  },
  single({
    id: "cluster",
    label: "Cluster entity",
    blurb: "An Effect Cluster entity from forma:effect/cluster: state, commands, and queries, each a typed slot.",
    focus: "(command Increment",
    source: `(entity Counter
  :state {:count Int}
  :initial {:count 0}
  :storage :memory
  (command Increment
    :payload {:by Int}
    :success Int
    :delivery :volatile
    :update {:count (+ state.count by)}
    :reply state.count)
  (query Count :success Int :reply state.count))`,
  }),
  single({
    id: "hole",
    label: "Typed hole",
    blurb: "A ?hole reports the type it needs and the names in scope that fit.",
    focus: "(?fill name)",
    source: `(: greet (-> String String))
(define greet [name] (str "Hello, " name))

(: shout (-> String String))
(define shout [name] (?fill name))`,
  }),
];
