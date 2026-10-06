let diagnostic = Type_diagnostic.make

let bind env name = function
  | Ast.List (span, (Ast.Keyword (_, ":fields") | Ast.Symbol (_, ":fields")) :: fields)
    ->
      let schema_expr = Ast.List (span, Ast.Symbol (span, "Struct") :: fields) in
      Typed_schema_projection.bind env name schema_expr
  | bad ->
      Error
        [
          diagnostic ~span:(Ast.expr_span bad) "typecheck/define-error"
            "__error expects a (:fields ...) block.";
        ]
