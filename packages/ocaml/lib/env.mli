type t

val empty : t
val lookup : string -> t -> Value.t option
val bind : string -> Value.t -> t -> t
val extend : (string * Value.t) list -> t -> t
val bindings : t -> (string * Value.t) list
val of_bindings : (string * Value.t) list -> t
val length : t -> int
val remove_names : string list -> t -> t

val visible_bindings : t -> (string * Value.t) list
