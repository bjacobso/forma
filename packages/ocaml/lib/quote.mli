type diagnostic = { code : string; message : string }

val value_of_syntax : Ast.expr -> Value.t
val syntax_of_value : Value.t -> (Ast.expr, diagnostic list) result
val quote : Ast.expr list -> (Value.t, diagnostic list) result

val quasiquote :
  eval:(Ast.expr -> (Value.t, diagnostic list) result) ->
  Ast.expr list ->
  (Value.t, diagnostic list) result

val with_syntax_arguments : Ast.expr list -> (Value.t list -> 'a) -> 'a
