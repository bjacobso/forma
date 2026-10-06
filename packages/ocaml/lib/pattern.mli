type bindings = (string * Value.t) list

val match_value : ?constructor_spec:(string -> Value.t option) -> Ast.expr -> Value.t -> bindings option
