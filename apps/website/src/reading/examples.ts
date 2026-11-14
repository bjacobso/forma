import { ordersSource } from "../effectPageSources";

export interface ReadingExample {
  readonly id: string;
  readonly label: string;
  readonly blurb: string;
  readonly source: string;
  /** Text to select when the example opens. */
  readonly focus?: string;
}

export const readingExamples: readonly ReadingExample[] = [
  {
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
  },
  {
    id: "effect",
    label: "Effect operation",
    blurb: "Every Effect form carries its success type, the errors it can fail with, and the services it needs.",
    focus: "(retry (Payments.charge",
    source: ordersSource,
  },
  {
    id: "rpc",
    label: "RPC group",
    blurb: "A prelude form: rpc-group comes from forma:effect/rpc, with documented, typed slots.",
    focus: "(rpc \"ReserveSeats\"",
    source: `; A workshop has twelve seats. A reservation claims 1–6 seats atomically.
(type WorkshopId (String :pattern "^ws-[a-z]+$"))
(type Seats (Int :min 1 :max 6))
(type Reserve {:id WorkshopId :seats Seats})
(type Workshop {:id WorkshopId :remaining Int})
(error WorkshopNotFound {:id WorkshopId} :status 404)
(error NotEnoughSeats {:id WorkshopId :requested Seats :remaining Int} :status 409)

(rpc-group WorkshopRpc
  (rpc "GetWorkshop" :payload {:id WorkshopId} :success Workshop :error WorkshopNotFound)
  (rpc "ReserveSeats" :payload Reserve :success Workshop
    :error (Union WorkshopNotFound NotEnoughSeats)))`,
  },
  {
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
  },
  {
    id: "hole",
    label: "Typed hole",
    blurb: "A ?hole reports the type it needs and the names in scope that fit.",
    focus: "(?fill name)",
    source: `(: greet (-> String String))
(define greet [name] (str "Hello, " name))

(: shout (-> String String))
(define shout [name] (?fill name))`,
  },
];
